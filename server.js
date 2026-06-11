require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/orders',    require('./routes/orders'));
app.use('/api/nannies',   require('./routes/nannies'));
app.use('/api/children',  require('./routes/children'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/messages',  require('./routes/messages'));
app.use('/api/wallet',    require('./routes/wallet'));
app.use('/api/parents',   require('./routes/parents'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌸 SabiTrack на http://localhost:${PORT}`));
