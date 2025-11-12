const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');

const upload = multer({ dest: '/tmp/' });

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  upload.single('audio')(req, res, async function(err) {
    if (err) return res.status(500).send('Upload Error');

    try {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(req.file.path));
      formData.append('model', 'whisper-1');

      // Whisper API
      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: formData
      });
      const whisperData = await whisperRes.json();
      const text = whisperData.text;

      // Gemini API
      const geminiRes = await fetch('https://api.gemini.com/analyze', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GEMINI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text })
      });
      const geminiData = await geminiRes.json();

      // Notion API
      const notionRes = await fetch(`https://api.notion.com/v1/pages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          parent: { database_id: process.env.NOTION_DB_ID },
          properties: {
            Title: { title: [{ text: { content: geminiData.title || text } }] },
            Type: { select: { name: geminiData.type || 'Memo' } },
            Category: { multi_select: (geminiData.category || []).map(c => ({ name: c })) },
            Notes: { rich_text: [{ text: { content: text } }] }
          }
        })
      });
      const notionData = await notionRes.json();

      fs.unlinkSync(req.file.path);

      res.status(200).json({ transcription: text, gemini: geminiData, notion: notionData });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error processing audio');
    }
  });
};