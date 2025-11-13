const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { audioBase64 } = req.body;
    if (!audioBase64) return res.status(400).json({ error: 'Missing audio data' });

    // 一時ファイル作成
    const tmpPath = path.join('/tmp', `audio-${Date.now()}.wav`);
    fs.writeFileSync(tmpPath, Buffer.from(audioBase64, 'base64'));

    // Whisper APIで文字起こし
    const formData = new FormData();
    formData.append('file', fs.createReadStream(tmpPath));
    formData.append('model', 'whisper-1');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData
    });

    const whisperData = await whisperRes.json();
    const text = whisperData.text || "";

    // Gemini APIでタスク整理
    const prompt = `
以下の文章をタスク管理用に解析してください。
文章: "${text}"

出力形式(JSON):
{
  "title": "タスクタイトル（短く）",
  "type": "タスクの種類（ToDo/Memo/調査など）",
  "category": ["カテゴリ1","カテゴリ2"],
  "notes": "補足や要約"
}
必ず JSON のみ出力してください。
`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    const geminiDataRaw = await geminiRes.json();

    // Gemini APIの結果をJSONにパース
    let geminiData = {};
    try {
      const candidateText = geminiDataRaw.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      geminiData = JSON.parse(candidateText);
    } catch (e) {
      console.error("Gemini parse error:", e);
      geminiData = {};
    }

    // Notion API 用プロパティ作成
    const notionProperties = {
      "Task name": { title: [{ text: { content: title || "音声タスク" } }] } // 必須
    };

    // 任意列（存在すれば追加）
    if (status) notionProperties["Status"] = { select: { name: status } };
    if (assignee) notionProperties["Assignee"] = { rich_text: [{ text: { content: assignee } }] };
    if (dueDate) notionProperties["Due date"] = { date: { start: dueDate } };
    if (priority) notionProperties["Priority"] = { select: { name: priority } };
    if (type) notionProperties["Task type"] = { select: { name: type } };
    if (notes) notionProperties["Description"] = { rich_text: [{ text: { content: notes } }] };
    if (effortLevel) notionProperties["Effort level"] = { select: { name: effortLevel } };

    // Notion API 呼び出し
    const notionRes = await fetch(`https://api.notion.com/v1/pages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parent: { database_id: process.env.NOTION_DB_ID },
        properties: notionProperties
      })
    });

    const notionData = await notionRes.json();

    // 一時ファイル削除
    fs.unlinkSync(tmpPath);

    res.status(200).json({ transcription: text, gemini: geminiData, notion: notionData });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error processing audio' });
  }
};
