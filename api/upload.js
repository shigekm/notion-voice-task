const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { audioBase64 } = req.body;
    if (!audioBase64) return res.status(400).json({ error: 'Missing audio data' });

    const tmpPath = path.join('/tmp', `audio-${Date.now()}.wav`);
    fs.writeFileSync(tmpPath, Buffer.from(audioBase64, 'base64'));

    const formData = new FormData();
    formData.append('file', fs.createReadStream(tmpPath));
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
    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `以下のテキストを解析して、タイトル、種類（task/memoなど）、カテゴリ（["仕事","家庭","健康"]など）をJSONで出力してください。\n\n${text}` }
            ]
          }
        ]
      })
    });

    const geminiDataRaw = await geminiRes.json();

    // Gemini API の応答をシンプルな JSON に整形
    let geminiData = {};
    try {
      const parsed = JSON.parse(geminiDataRaw.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
      geminiData = parsed;
    } catch (e) {
      console.error("Gemini parse error:", e);
      geminiData = { title: text.slice(0, 30), type: "Memo", category: ["その他"] };
    }


    // Notion API

    const title = geminiData.title || text?.slice(0, 50) || "音声メモ";

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
    res.status(500).json({ error: 'Error processing audio' });
  }
};
