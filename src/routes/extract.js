const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { extractTextFromBuffer, extractPhotoFromBuffer } = require('../utils/fileParser');
const { getOpenAIClient } = require('../utils/openai');

// Memory storage — no disk writes, works on Vercel
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (['.pdf','.doc','.docx','.txt'].some(e => name.endsWith(e))) cb(null, true);
    else cb(new Error('Only PDF, DOC, DOCX, TXT files are allowed'));
  },
});

router.post('/', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const buffer   = req.file.buffer;
    const filename = req.file.originalname;

    // 1. Extract text
    const resumeText = await extractTextFromBuffer(buffer, filename);

    // 2. GPT-4o structured extraction
    let extracted = {};
    try {
      const openai = await getOpenAIClient();
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Extract candidate information from the resume. Return ONLY valid JSON, no markdown or code fences.' },
          { role: 'user', content: `Extract candidate data from the resume and return as JSON with this exact structure (use empty string or empty array if not found):
{
  "fullName": "candidate full name",
  "email": "email address",
  "phone": "phone number",
  "linkedinUrl": "LinkedIn URL if present",
  "location": "city and country",
  "currentTitle": "most recent job title",
  "summary": "professional summary or about section",
  "experiences": [
    { "job_title": "title", "company": "company name", "start_date": "YYYY-MM or YYYY", "end_date": "YYYY-MM or YYYY or present", "description": "role description" }
  ],
  "educations": [
    { "degree_name": "degree or field of study", "school": "school name", "start_year": "YYYY", "end_year": "YYYY" }
  ],
  "skills": ["skill1", "skill2"],
  "certifications": [
    { "name": "certification name", "authority": "issuing organization" }
  ],
  "languages": ["language1", "language2"]
}

RESUME:
${resumeText.substring(0, 6000)}` },
        ],
        max_tokens: 2000,
        temperature: 0,
        response_format: { type: 'json_object' },
      });
      extracted = JSON.parse(completion.choices[0].message.content);
    } catch (aiErr) {
      console.error('[Extract] AI error:', aiErr.message);
    }

    // 3. Try to extract photo from PDF
    let photoUrl = '';
    if (filename.toLowerCase().endsWith('.pdf')) {
      try { photoUrl = (await extractPhotoFromBuffer(buffer)) || ''; } catch (_) {}
    }

    const linkedinProfile = {
      summary:        extracted.summary        || '',
      experiences:    Array.isArray(extracted.experiences)    ? extracted.experiences.slice(0, 3)    : [],
      educations:     Array.isArray(extracted.educations)     ? extracted.educations     : [],
      skills:         Array.isArray(extracted.skills)         ? extracted.skills         : [],
      certifications: Array.isArray(extracted.certifications) ? extracted.certifications : [],
      languages:      Array.isArray(extracted.languages)      ? extracted.languages      : [],
    };

    res.json({
      fullName:     extracted.fullName     || '',
      email:        extracted.email        || '',
      phone:        extracted.phone        || '',
      linkedinUrl:  extracted.linkedinUrl  || '',
      location:     extracted.location     || '',
      currentTitle: extracted.currentTitle || '',
      photoUrl,
      resumeText,
      resumeFileName: filename,
      linkedinProfile,
    });
  } catch (err) {
    console.error('[Extract]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
