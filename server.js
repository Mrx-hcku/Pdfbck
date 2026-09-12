const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Hardcoded Configurations
const MONGO_URI = 'mongodb+srv://Rahul:AdminSong@cluster0.kus25.mongodb.net/socialDB?retryWrites=true&w=majority&appName=Cluster0';
const TELEGRAM_BOT_TOKEN = '8914960632:AAEbiR70JZBYXgYZ3cbxRP0Ekkv9U6wCYIo';
const TELEGRAM_CHANNEL_ID = '-1003947413983';

// Memory storage for handling file uploads before sending to Telegram
const upload = multer({ storage: multer.memoryStorage() });

// MongoDB Connection
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB Connected Successfully'))
.catch((err) => console.error('MongoDB Connection Error:', err));

const materialSchema = new mongoose.Schema({
  title: String,
  author: String,
  isPaid: Boolean,
  price: String,
  followRequired: Boolean,
  telegramFileId: String,
  fileSize: String,
});

const Material = mongoose.model('Material', materialSchema);

// Root Health Check Route
app.get('/', (req, res) => {
  res.status(200).json({ success: true, message: 'PdfPoint Backend is running live!' });
});

// 1. Upload PDF Endpoint
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  try {
    const { title, author, isPaid, price, followRequired } = req.body;
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
      { headers: formData.getHeaders() }
    );

    const telegramFileId = tgResponse.data.result.document.file_id;
    const fileSize = (req.file.size / (1024 * 1024)).toFixed(1) + ' MB';

    // Save lightweight metadata to MongoDB
    const newMaterial = new Material({
      title,
      author,
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
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Fetch All Materials Feed
app.get('/api/materials', async (req, res) => {
  try {
    const materials = await Material.find({});
    res.status(200).json({ success: true, data: materials });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Get Direct Download URL from Telegram File ID
app.get('/api/download/:id', async (req, res) => {
  try {
    const material = await Material.findById(req.params.id);
    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    // Request fresh file path from Telegram Bot API
    const fileInfoRes = await axios.get(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${material.telegramFileId}`
    );

    const filePath = fileInfoRes.data.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

    res.status(200).json({ success: true, downloadUrl });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
        
