const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // index.html から送信される key に合わせる
    const { audioBase64 } = req.body;
    if (!audioBase64) return res.status(400).json({ error: 'Missing audio data' });

    // 一時ファイルに保存
    const tmpPath = path.join('/tmp', `audio-${Date.now()}.wav`);
    fs.writeFileSync(tmpPath, Buffer.from(audioBase64, 'base64'));

    // Whisper API
    const formData = new FormData();
    formData.append('file', fs.createReadStream(tmpPath));
    formData.append('model', 'whisper-1');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData
    });
    const whisperData = await whisperRes.json();
    const text = whisperData.text && whisperData.text.length > 0 ? whisperData.text : "音声内容なし";

    // Gemini API（タスク用に整理）
    let geminiData = {
      title: text.slice(0,50),
      type: "Memo",
      category: [],
      status: "",
      assignee: "",
      dueDate: "",
      priority: "",
      effortLevel: ""
    };
    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: `以下のテキストを解析して、タスク用に整理し、JSONでタイトル・種類（type）・カテゴリ・Status・Assignee・Due date・Priority・Effort levelを出力してください。\n\n${text}` }
                ]
              }
            ]
          })
        }
      );
      const geminiRaw = await geminiRes.json();
      const parsed = JSON.parse(geminiRaw.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
      geminiData = {
        title: parsed.title || text.slice(0,50),
        type: parsed.type || "Memo",
        category: Array.isArray(parsed.category) ? parsed.category : [],
        status: parsed.status || "",
        assignee: parsed.assignee || "",
        dueDate: parsed.dueDate || "",
        priority: parsed.priority || "",
        effortLevel: parsed.effortLevel || ""
      };
    } catch (e) {
      console.error("Gemini parse error:", e);
    }

    // Notion プロパティ作成（必須以外は multi_select / rich_text / date で適宜設定）
    const notionProperties = {
      "Task name": { title: [{ text: { content: geminiData.title } }] } // 必須
    };

    if (geminiData.type) {
      const types = geminiData.type.split(',').map(t => t.trim()).filter(t => t);
      notionProperties["Task type"] = { multi_select: types.map(t => ({ name: t })) };
    }
    if (geminiData.status) {
      const statuses = geminiData.status.split(',').map(s => s.trim()).filter(s => s);
      notionProperties["Status"] = { multi_select: statuses.map(s => ({ name: s })) };
    }
    if (geminiData.assignee) notionProperties["Assignee"] = { rich_text: [{ text: { content: geminiData.assignee } }] };
    if (geminiData.dueDate) notionProperties["Due date"] = { date: { start: geminiData.dueDate } };
    if (geminiData.priority) {
      const priorities = geminiData.priority.split(',').map(p => p.trim()).filter(p => p);
      notionProperties["Priority"] = { multi_select: priorities.map(p => ({ name: p })) };
    }
    if (geminiData.category.length > 0) notionProperties["Description"] = { rich_text: [{ text: { content: geminiData.category.join(", ") } }] };
    if (geminiData.effortLevel) notionProperties["Effort level"] = { rich_text: [{ text: { content: geminiData.effortLevel } }] };

    // Notion API 送信
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

    fs.unlinkSync(tmpPath);

    res.status(200).json({ transcription: text, gemini: geminiData, notion: notionData });

  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: 'Error processing audio' });
  }
};
