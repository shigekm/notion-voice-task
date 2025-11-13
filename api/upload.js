import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch'; // Node 18+なら不要、組み込みfetch使える

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { audioBase64 } = req.body;
    if (!audioBase64) return res.status(400).json({ error: 'Missing audio data' });

    const tmpPath = path.join('/tmp', `audio-${Date.now()}.wav`);
    fs.writeFileSync(tmpPath, Buffer.from(audioBase64, 'base64'));

    // Whisper API
    const whisperForm = new FormData();
    whisperForm.append('file', fs.createReadStream(tmpPath));
    whisperForm.append('model', 'whisper-1');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: whisperForm
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

    fs.unlinkSync(tmpPath);

    res.status(200).json({ transcription: text, gemini: geminiData, notion: notionData });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error processing audio', detail: err.message });
  }
}
