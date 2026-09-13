const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ---- Config from environment variables (set these on your hosting platform) ----
const MONGO_URI = process.env.MONGO_URI;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const PORT = process.env.PORT || 3000;

if (!MONGO_URI || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
  console.error('Missing required environment variables: MONGO_URI, TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID');
  process.exit(1);
}

// Memory storage for handling file uploads before sending to Telegram
const upload = multer({ storage: multer.memoryStorage() });

// MongoDB Connection
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch((err) => console.error('MongoDB Connection Error:', err));

const materialSchema = new mongoose.Schema({
  title: String,
  author: String,
  category: { type: String, default: 'General' },
  isPaid: Boolean,
  price: String,
  followRequired: Boolean,
  telegramFileId: String,
  fileSize: String,
}, { timestamps: true });

const Material = mongoose.model('Material', materialSchema);

// Root Health Check Route
app.get('/', (req, res) => {
  res.status(200).json({ success: true, message: 'PdfPoint Backend is running live!' });
});

// 1. Upload PDF Endpoint
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  try {
    const { title, author, category, isPaid, price, followRequired } = req.body;
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'PDF file is required' });
    }

    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;

    // Forward file to Telegram Private Channel storage
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHANNEL_ID);
    formData.append('document', fileBuffer, { filename: fileName });

    const tgResponse = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,
      formData,
      { headers: formData.getHeaders(), timeout: 30000 }
    );

    const telegramFileId = tgResponse.data.result.document.file_id;
    const fileSize = (req.file.size / (1024 * 1024)).toFixed(1) + ' MB';

    // Save lightweight metadata to MongoDB
    const newMaterial = new Material({
      title,
      author,
      category: category && category.trim() !== '' ? category.trim() : 'General',
      isPaid: isPaid === 'true',
      price: price || 'Free',
      followRequired: followRequired === 'true',
      telegramFileId,
      fileSize,
    });

    await newMaterial.save();

    res.status(201).json({
      success: true,
      message: 'PDF successfully stored on Telegram and metadata saved to MongoDB',
      data: newMaterial,
    });
  } catch (error) {
    console.error('Upload error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Fetch Materials Feed (optionally filtered by ?author= or ?category=)
app.get('/api/materials', async (req, res) => {
  try {
    const filter = {};
    if (req.query.author) filter.author = req.query.author;
    if (req.query.category) filter.category = req.query.category;

    const materials = await Material.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: materials });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Get list of distinct categories (for the upload screen's selector)
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await Material.distinct('category');
    res.status(200).json({ success: true, data: categories.filter(Boolean) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Get list of distinct teachers/authors (for the "Suggested teachers" row)
app.get('/api/teachers', async (req, res) => {
  try {
    const teachers = await Material.distinct('author');
    res.status(200).json({ success: true, data: teachers.filter(Boolean) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Get Direct Download URL from Telegram File ID
app.get('/api/download/:id', async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);
    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    // Request fresh file path from Telegram Bot API
    const fileInfoRes = await axios.get(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${material.telegramFileId}`,
      { timeout: 15000 }
    );

    const filePath = fileInfoRes.data.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

    res.status(200).json({ success: true, downloadUrl });
  } catch (error) {
    console.error('Download error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
                                   
