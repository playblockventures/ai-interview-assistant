/**
 * File parsing utilities — works with Buffers (in-memory).
 * Never writes to disk, fully compatible with Vercel's read-only filesystem.
 */
const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');

// Extract text from a Buffer
const extractTextFromBuffer = async (buffer, filename = '') => {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.pdf')) {
    try { const d = await pdfParse(buffer); return d.text || ''; }
    catch (e) { console.error('[FileParser] PDF error:', e.message); return ''; }
  }
  if (name.endsWith('.docx')) {
    try { const r = await mammoth.extractRawText({ buffer }); return r.value || ''; }
    catch (e) { console.error('[FileParser] DOCX error:', e.message); return ''; }
  }
  try { return buffer.toString('utf-8'); } catch (_) { return ''; }
};

// Legacy path-based — kept for backward compat but reads into buffer first
const extractTextFromFile = async (filePath, mimetype) => {
  const fs = require('fs');
  const buffer = fs.readFileSync(filePath);
  const name = filePath.toLowerCase();
  return extractTextFromBuffer(buffer, name.endsWith('.pdf') ? 'f.pdf' : name.endsWith('.docx') ? 'f.docx' : 'f.txt');
};

// Extract first embedded photo from a PDF buffer (returns base64 data URL or null)
const extractPhotoFromBuffer = async (buffer) => {
  try {
    let imgStart = -1, imgEnd = -1, imgType = '';
    for (let i = 0; i < buffer.length - 4; i++) {
      if (buffer[i] === 0xff && buffer[i+1] === 0xd8 && buffer[i+2] === 0xff && imgStart === -1) {
        imgStart = i; imgType = 'jpeg';
      }
      if (imgType === 'jpeg' && imgStart !== -1 && buffer[i] === 0xff && buffer[i+1] === 0xd9) {
        imgEnd = i + 2; break;
      }
      if (buffer[i] === 0x89 && buffer[i+1] === 0x50 && buffer[i+2] === 0x4e && buffer[i+3] === 0x47 && imgStart === -1) {
        imgStart = i; imgType = 'png';
      }
      if (imgType === 'png' && imgStart !== -1 && buffer[i] === 0x49 && buffer[i+1] === 0x45 && buffer[i+2] === 0x4e && buffer[i+3] === 0x44) {
        imgEnd = i + 8; break;
      }
    }
    if (imgStart !== -1 && imgEnd > imgStart) {
      const imgBuf = buffer.slice(imgStart, imgEnd);
      if (imgBuf.length > 5000) {
        return `data:image/${imgType === 'png' ? 'png' : 'jpeg'};base64,${imgBuf.toString('base64')}`;
      }
    }
    return null;
  } catch (_) { return null; }
};

// Legacy path-based photo extraction
const extractPhotoFromPdf = async (filePath) => {
  const fs = require('fs');
  return extractPhotoFromBuffer(fs.readFileSync(filePath));
};

module.exports = { extractTextFromBuffer, extractTextFromFile, extractPhotoFromBuffer, extractPhotoFromPdf };
