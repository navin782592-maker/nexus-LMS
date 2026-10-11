const express = require('express');
const session = require('express-session');
const fileUpload = require('express-fileupload');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use(fileUpload({ limits: { fileSize: 50 * 1024 * 1024 } }));
app.use(session({
    secret: 'supersecret_lms_key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // in prod should be true with https
}));

// Database Pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'lms_user',
    password: process.env.DB_PASSWORD || 'lms_pass_change_me',
    database: 'lms_system',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Auth Middleware
function checkAuth(roles) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        if (!roles.includes(req.session.user.role)) {
            return res.status(403).json({ error: 'Not authorized' });
        }
        next();
    };
}

// Routes

// 1. Authentication
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        
        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });
        
        if (!user.is_approved) {
            return res.status(403).json({ error: 'Account pending admin approval.' });
        }

        req.session.user = { id: user.id, username: user.username, role: user.role };
        res.json({ message: 'Logged in successfully', role: user.role });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out' });
});

app.get('/api/session', (req, res) => {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: 'Not logged in' });
    }
});

// Student Registration
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password, role, is_approved) VALUES (?, ?, ?, ?)', [username, hashedPassword, 'student', 0]);
        res.json({ message: 'Registration successful! Waiting for admin approval.' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Username already exists' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});


// 2. Admin Routes
app.post('/api/admin/staff', checkAuth(['admin']), async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password, role, is_approved) VALUES (?, ?, ?, ?)', [username, hashedPassword, 'staff', 1]);
        res.json({ message: 'Staff created successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/classes', checkAuth(['admin']), async (req, res) => {
    const { name } = req.body;
    try {
        await pool.query('INSERT INTO classes (name) VALUES (?)', [name]);
        res.json({ message: 'Class created successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/students', checkAuth(['admin']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT u.id, u.username, u.is_approved, s.full_name, s.class_id, s.phone, s.address, c.name as class_name FROM users u LEFT JOIN student_details s ON u.id = s.user_id LEFT JOIN classes c ON s.class_id = c.id WHERE u.role = "student"');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin updates student details
app.post('/api/admin/student/update-details', checkAuth(['admin']), async (req, res) => {
    const { student_id, full_name, class_id, phone, address } = req.body;
    if (!student_id) return res.status(400).json({ error: 'Student ID required' });
    try {
        const [existing] = await pool.query('SELECT * FROM student_details WHERE user_id = ?', [student_id]);
        if (existing.length > 0) {
            await pool.query('UPDATE student_details SET full_name=?, class_id=?, phone=?, address=? WHERE user_id=?', [full_name, class_id, phone, address, student_id]);
        } else {
            await pool.query('INSERT INTO student_details (user_id, full_name, class_id, phone, address) VALUES (?, ?, ?, ?, ?)', [student_id, full_name, class_id, phone, address]);
        }
        res.json({ message: 'Student profile updated successfully by Admin' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/approve-student/:id', checkAuth(['admin']), async (req, res) => {
    try {
        await pool.query('UPDATE users SET is_approved = 1 WHERE id = ?', [req.params.id]);
        res.json({ message: 'Student approved' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/staff', checkAuth(['admin']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT u.id, u.username, s.full_name, s.staff_id, s.age, s.aadhaar, s.phone FROM users u LEFT JOIN staff_details s ON u.id = s.user_id WHERE u.role = "staff" ORDER BY u.id');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/staff/update-details', checkAuth(['admin']), async (req, res) => {
    const { staff_user_id, full_name, staff_id, age, aadhaar, phone } = req.body;
    if (!staff_user_id) return res.status(400).json({ error: 'Staff User ID required' });
    try {
        const [existing] = await pool.query('SELECT * FROM staff_details WHERE user_id = ?', [staff_user_id]);
        if (existing.length > 0) {
            await pool.query('UPDATE staff_details SET full_name=?, staff_id=?, age=?, aadhaar=?, phone=? WHERE user_id=?', [full_name, staff_id, age, aadhaar, phone, staff_user_id]);
        } else {
            await pool.query('INSERT INTO staff_details (user_id, full_name, staff_id, age, aadhaar, phone) VALUES (?, ?, ?, ?, ?, ?)', [staff_user_id, full_name, staff_id, age, aadhaar, phone]);
        }
        res.json({ message: 'Staff profile updated successfully by Admin' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/admin/staff/:id', checkAuth(['admin']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id FROM users WHERE id = ? AND role = "staff"', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Staff not found' });
        await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        res.json({ message: 'Staff account deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/classes', checkAuth(['admin', 'staff', 'student']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT c.*, u.username as mentor_username, sp.full_name as mentor_name
             FROM classes c
             LEFT JOIN users u ON c.mentor_id = u.id
             LEFT JOIN staff_details sp ON u.id = sp.user_id`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});


app.get('/api/all-staff', checkAuth(['admin', 'staff', 'student']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT u.id, u.username, s.full_name, s.staff_id, s.age, s.aadhaar, s.phone FROM users u LEFT JOIN staff_details s ON u.id = s.user_id WHERE u.role = "staff" ORDER BY u.id');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/staff/details', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM staff_details WHERE user_id = ?', [req.session.user.id]);
        res.json({ details: rows[0] || null });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/staff/details', checkAuth(['staff']), async (req, res) => {
    const { full_name, staff_id, age, aadhaar, phone } = req.body;
    try {
        const [existing] = await pool.query('SELECT * FROM staff_details WHERE user_id = ?', [req.session.user.id]);
        if (existing.length > 0) {
            return res.status(403).json({ error: 'Profile details can only be created once by the staff. Please contact Admin to make changes.' });
        } else {
            await pool.query('INSERT INTO staff_details (user_id, full_name, staff_id, age, aadhaar, phone) VALUES (?, ?, ?, ?, ?, ?)', [req.session.user.id, full_name, staff_id, age, aadhaar, phone]);
        }
        res.json({ message: 'Profile details saved successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// 3. Staff Routes
app.get('/api/staff/students', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT u.id, u.username, s.full_name, c.name as class_name, s.phone, s.address FROM users u JOIN student_details s ON u.id = s.user_id LEFT JOIN classes c ON s.class_id = c.id WHERE u.role = "student" AND u.is_approved = 1');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/staff/material', checkAuth(['staff']), async (req, res) => {
    try {
        const { title, class_id } = req.body;
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({ error: 'No files were uploaded.' });
        }
        const file = req.files.materialFile;
        const filename = Date.now() + '_' + file.name;
        const uploadPath = path.join(__dirname, 'public/uploads', filename);

        file.mv(uploadPath, async (err) => {
            if (err) return res.status(500).json({ error: err.message });
            await pool.query('INSERT INTO materials (title, file_url, class_id, uploaded_by) VALUES (?, ?, ?, ?)', [title, '/uploads/' + filename, class_id, req.session.user.id]);
            res.json({ message: 'File uploaded successfully' });
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/staff/form', checkAuth(['staff']), async (req, res) => {
    const { title, link, class_id } = req.body;
    try {
        await pool.query('INSERT INTO forms (title, link, staff_id, class_id) VALUES (?, ?, ?, ?)', [title, link, req.session.user.id, class_id || null]);
        res.json({ message: 'Form shared successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/staff/forms', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT f.id, f.title, f.link, c.name as class_name, u.username as staff_name FROM forms f LEFT JOIN classes c ON f.class_id = c.id JOIN users u ON f.staff_id = u.id WHERE f.staff_id = ?', [req.session.user.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/staff/form/:id', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id FROM forms WHERE id = ? AND staff_id = ?', [req.params.id, req.session.user.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Form not found or unauthorized' });
        await pool.query('DELETE FROM forms WHERE id = ?', [req.params.id]);
        res.json({ message: 'Form deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/staff/materials', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT m.id, m.title, m.file_url, c.name as class_name FROM materials m LEFT JOIN classes c ON m.class_id = c.id WHERE m.uploaded_by = ?', [req.session.user.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/staff/material/:id', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT file_url FROM materials WHERE id = ? AND uploaded_by = ?', [req.params.id, req.session.user.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Material not found or unauthorized' });
        
        const fileUrl = rows[0].file_url;
        const filePath = path.join(__dirname, 'public', fileUrl);
        
        const fs = require('fs');
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        await pool.query('DELETE FROM materials WHERE id = ?', [req.params.id]);
        res.json({ message: 'Material deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/staff/attendance-list', checkAuth(['staff']), async (req, res) => {
    const { class_id, date } = req.query;
    try {
        const [students] = await pool.query('SELECT u.id, s.full_name, u.username FROM users u JOIN student_details s ON u.id = s.user_id WHERE u.role = "student" AND u.is_approved = 1 AND s.class_id = ?', [class_id]);
        const [attendance] = await pool.query('SELECT student_id, status FROM attendance WHERE class_id = ? AND date = ?', [class_id, date]);
        
        const attendanceMap = {};
        attendance.forEach(a => attendanceMap[a.student_id] = a.status);
        
        const result = students.map(st => ({
            id: st.id,
            name: st.full_name || st.username,
            username: st.username,
            status: attendanceMap[st.id] || null
        }));
        
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/staff/attendance', checkAuth(['staff']), async (req, res) => {
    const { class_id, date, attendance_data } = req.body;
    try {
        for (const record of attendance_data) {
            await pool.query(
                'INSERT INTO attendance (student_id, class_id, date, status, marked_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = ?',
                [record.student_id, class_id, date, record.status, req.session.user.id, record.status]
            );
        }
        res.json({ message: 'Attendance marked successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});




// 4. Student Routes
app.post('/api/student/details', checkAuth(['student']), async (req, res) => {
    const { full_name, class_id, phone, address } = req.body;
    try {
        const [existing] = await pool.query('SELECT * FROM student_details WHERE user_id = ?', [req.session.user.id]);
        if (existing.length > 0) {
            return res.status(403).json({ error: 'Profile details can only be created once by the student. Please contact Admin to make changes.' });
        } else {
            await pool.query('INSERT INTO student_details (user_id, full_name, class_id, phone, address) VALUES (?, ?, ?, ?, ?)', [req.session.user.id, full_name, class_id, phone, address]);
        }
        res.json({ message: 'Profile details saved successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/student/details', checkAuth(['student']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT s.*, c.name as class_name FROM student_details s LEFT JOIN classes c ON s.class_id = c.id WHERE s.user_id = ?', [req.session.user.id]);
        if (rows.length > 0) {
            res.json({ details: rows[0] });
        } else {
            res.json({ details: null });
        }
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/student/materials', checkAuth(['student']), async (req, res) => {
    try {
        const [studentClass] = await pool.query('SELECT class_id FROM student_details WHERE user_id = ?', [req.session.user.id]);
        if (studentClass.length === 0 || !studentClass[0].class_id) {
            return res.status(400).json({ error: 'Please complete your details and select a class first.' });
        }
        const [rows] = await pool.query('SELECT m.title, m.file_url, u.username as staff_name FROM materials m JOIN users u ON m.uploaded_by = u.id WHERE m.class_id = ?', [studentClass[0].class_id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/student/forms', checkAuth(['student']), async (req, res) => {
    try {
        const [studentClass] = await pool.query('SELECT class_id FROM student_details WHERE user_id = ?', [req.session.user.id]);
        const studentClassId = studentClass.length > 0 ? studentClass[0].class_id : null;
        const [rows] = await pool.query(
            'SELECT f.title, f.link, u.username as staff_name FROM forms f JOIN users u ON f.staff_id = u.id WHERE f.class_id IS NULL OR f.class_id = ?',
            [studentClassId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// =====================
// 5. Messaging Routes (Student -> Staff)
// =====================

// Get staff list for student (staff who uploaded materials for their class, plus all staff)
app.get('/api/student/staff-list', checkAuth(['student']), async (req, res) => {
    try {
        // Get all staff accounts
        const [rows] = await pool.query('SELECT id, username FROM users WHERE role = "staff" ORDER BY username');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Student sends a message to staff (with optional file attachment)
app.post('/api/student/send-message', checkAuth(['student']), async (req, res) => {
    try {
        const { staff_id, message } = req.body;
        
        if (!staff_id) {
            return res.status(400).json({ error: 'Please select a staff recipient' });
        }
        
        if (!message && (!req.files || Object.keys(req.files).length === 0)) {
            return res.status(400).json({ error: 'Please provide a message or attach a file' });
        }

        let media_url = null;
        let media_type = 'text';

        // Handle file upload if present
        if (req.files && req.files.messageFile) {
            const file = req.files.messageFile;
            const ext = path.extname(file.name).toLowerCase();
            
            // Determine media type category
            if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
                media_type = 'image';
            } else if (['.mp3', '.wav', '.ogg', '.m4a', '.webm', '.aac', '.opus'].includes(ext)) {
                media_type = 'audio';
            } else if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) {
                media_type = 'video';
            } else {
                media_type = 'file';
            }
            
            const filename = 'msg_' + Date.now() + '_' + file.name;
            const uploadPath = path.join(__dirname, 'public/uploads', filename);

            await new Promise((resolve, reject) => {
                file.mv(uploadPath, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
            media_url = '/uploads/' + filename;
        }

        await pool.query(
            'INSERT INTO messages (sender_id, receiver_id, message_text, media_url, media_type) VALUES (?, ?, ?, ?, ?)',
            [req.session.user.id, staff_id, message || null, media_url, media_type]
        );

        res.json({ message: 'Message sent successfully' });
    } catch (err) {
        console.error('Send message error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Student views their sent messages
app.get('/api/student/my-messages', checkAuth(['student']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT m.id, m.message_text, m.media_url, m.media_type, m.created_at, u.username as staff_name 
             FROM messages m 
             JOIN users u ON m.receiver_id = u.id 
             WHERE m.sender_id = ? 
             ORDER BY m.created_at DESC`,
            [req.session.user.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Student views messages received from staff (inbox)
app.get('/api/student/inbox-messages', checkAuth(['student']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT m.id, m.message_text, m.media_url, m.media_type, m.created_at,
                    u.id as staff_id, u.username as staff_username
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             WHERE m.receiver_id = ? AND u.role = 'staff'
             ORDER BY m.created_at DESC`,
            [req.session.user.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff views received messages (inbox)
app.get('/api/staff/inbox-messages', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT m.id, m.message_text, m.media_url, m.media_type, m.created_at, 
                    u.id as student_id, u.username as student_username, 
                    s.full_name
             FROM messages m 
             JOIN users u ON m.sender_id = u.id 
             LEFT JOIN student_details s ON u.id = s.user_id 
             WHERE m.receiver_id = ? 
             ORDER BY m.created_at DESC`,
            [req.session.user.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// =====================
// 6. Messaging Routes (Staff -> Student)
// =====================

// Staff sends a message to a student (with optional file attachment)
app.post('/api/staff/send-message', checkAuth(['staff']), async (req, res) => {
    try {
        const { student_id, message } = req.body;

        if (!student_id) {
            return res.status(400).json({ error: 'Please select a student recipient' });
        }

        if (!message && (!req.files || Object.keys(req.files).length === 0)) {
            return res.status(400).json({ error: 'Please provide a message or attach a file' });
        }

        let media_url = null;
        let media_type = 'text';

        if (req.files && req.files.messageFile) {
            const file = req.files.messageFile;
            const ext = path.extname(file.name).toLowerCase();

            if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)) {
                media_type = 'image';
            } else if (['.mp3', '.wav', '.ogg', '.m4a', '.webm', '.aac', '.opus'].includes(ext)) {
                media_type = 'audio';
            } else if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) {
                media_type = 'video';
            } else {
                media_type = 'file';
            }

            const filename = 'msg_' + Date.now() + '_' + file.name;
            const uploadPath = path.join(__dirname, 'public/uploads', filename);

            await new Promise((resolve, reject) => {
                file.mv(uploadPath, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            media_url = '/uploads/' + filename;
        }

        await pool.query(
            'INSERT INTO messages (sender_id, receiver_id, message_text, media_url, media_type) VALUES (?, ?, ?, ?, ?)',
            [req.session.user.id, student_id, message || null, media_url, media_type]
        );

        res.json({ message: 'Message sent to student successfully' });
    } catch (err) {
        console.error('Staff send message error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff views sent messages to students
app.get('/api/staff/sent-messages', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT m.id, m.message_text, m.media_url, m.media_type, m.created_at,
                    u.id as student_id, u.username as student_username,
                    s.full_name
             FROM messages m
             JOIN users u ON m.receiver_id = u.id
             LEFT JOIN student_details s ON u.id = s.user_id
             WHERE m.sender_id = ?
             ORDER BY m.created_at DESC`,
            [req.session.user.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});
  
// Get approved students list for staff to message
app.get('/api/staff/students-for-msg', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT u.id, u.username, s.full_name, s.phone FROM users u LEFT JOIN student_details s ON u.id = s.user_id WHERE u.role = "student" AND u.is_approved = 1 ORDER BY u.username'
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get full chat between student and a specific staff
app.get('/api/student/chat/:staffId', checkAuth(['student']), async (req, res) => {
    try {
        const studentId = req.session.user.id;
        const staffId = req.params.staffId;
        
        const [rows] = await pool.query(
            `SELECT m.id, m.message_text, m.media_url, m.media_type, m.created_at, 
                    m.sender_id, m.receiver_id, m.is_read
             FROM messages m
             WHERE (m.sender_id = ? AND m.receiver_id = ?) 
                OR (m.sender_id = ? AND m.receiver_id = ?)
             ORDER BY m.created_at ASC`,
            [studentId, staffId, staffId, studentId]
        );
        
        // Also get staff details
        const [staffRows] = await pool.query(
            `SELECT id, username FROM users WHERE id = ?`,
            [staffId]
        );
        
        res.json({
            messages: rows,
            staff: staffRows.length > 0 ? staffRows[0] : null
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get full chat between staff and a specific student
app.get('/api/staff/chat/:studentId', checkAuth(['staff']), async (req, res) => {
    try {
        const staffId = req.session.user.id;
        const studentId = req.params.studentId;
        
        const [rows] = await pool.query(
            `SELECT m.id, m.message_text, m.media_url, m.media_type, m.created_at, 
                    m.sender_id, m.receiver_id, m.is_read
             FROM messages m
             WHERE (m.sender_id = ? AND m.receiver_id = ?) 
                OR (m.sender_id = ? AND m.receiver_id = ?)
             ORDER BY m.created_at ASC`,
            [staffId, studentId, studentId, staffId]
        );
        
        // Also get student details (name, phone)
        const [studentRows] = await pool.query(
            `SELECT u.id, u.username, s.full_name, s.phone 
             FROM users u 
             LEFT JOIN student_details s ON u.id = s.user_id 
             WHERE u.id = ?`,
            [studentId]
        );
        
        res.json({
            messages: rows,
            student: studentRows.length > 0 ? studentRows[0] : null
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// =====================
// 7. Unread / Mark-Read Routes
// =====================

// Mark messages as read for the current user (receiver) from a specific sender
app.post('/api/messages/mark-read', checkAuth(['staff', 'student']), async (req, res) => {
    try {
        const { sender_id } = req.body;
        if (!sender_id) return res.status(400).json({ error: 'sender_id required' });
        
        await pool.query(
            'UPDATE messages SET is_read = TRUE WHERE sender_id = ? AND receiver_id = ? AND is_read = FALSE',
            [sender_id, req.session.user.id]
        );
        res.json({ message: 'Messages marked as read' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Student: get unread message counts grouped by staff member
app.get('/api/student/unread-counts', checkAuth(['student']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT m.sender_id as staff_id, COUNT(*) as unread_count
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             WHERE m.receiver_id = ? AND u.role = 'staff' AND m.is_read = FALSE
             GROUP BY m.sender_id`,
            [req.session.user.id]
        );
        // Also get total unread count
        const [totalRows] = await pool.query(
            'SELECT COUNT(*) as total FROM messages WHERE receiver_id = ? AND is_read = FALSE',
            [req.session.user.id]
        );
        res.json({ perStaff: rows, total: totalRows[0].total });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff: get unread message counts grouped by student
app.get('/api/staff/unread-counts', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT m.sender_id as student_id, u.username, s.full_name, COUNT(*) as unread_count
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             LEFT JOIN student_details s ON u.id = s.user_id
             WHERE m.receiver_id = ? AND u.role = 'student' AND m.is_read = FALSE
             GROUP BY m.sender_id, u.username, s.full_name`,
            [req.session.user.id]
        );
        const [totalRows] = await pool.query(
            'SELECT COUNT(*) as total FROM messages WHERE receiver_id = ? AND is_read = FALSE',
            [req.session.user.id]
        );
        res.json({ perStudent: rows, total: totalRows[0].total });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// =====================
// 8. Quiz Routes
// =====================

// Staff creates a quiz with questions
app.post('/api/staff/quiz', checkAuth(['staff']), async (req, res) => {
    try {
        const { title, description, class_id, questions, quiz_password } = req.body;
        if (!title || !class_id || !questions || questions.length === 0) {
            return res.status(400).json({ error: 'Title, class, and at least one question are required' });
        }

        // Insert quiz (quiz_password is optional; if set, students need it to start)
        const [quizResult] = await pool.query(
            'INSERT INTO quizzes (title, description, class_id, staff_id, quiz_password) VALUES (?, ?, ?, ?, ?)',
            [title, description || '', class_id, req.session.user.id, quiz_password || null]
        );

        const quizId = quizResult.insertId;

        // Insert questions
        for (const q of questions) {
            if (!q.question_text || !q.option_a || !q.option_b || !q.option_c || !q.option_d || !q.correct_answer) {
                // Rollback by deleting quiz
                await pool.query('DELETE FROM quizzes WHERE id = ?', [quizId]);
                return res.status(400).json({ error: 'All question fields are required' });
            }
            await pool.query(
                'INSERT INTO quiz_questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_answer) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [quizId, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer]
            );
        }

        res.json({ message: 'Quiz created successfully', quizId });
    } catch (err) {
        console.error('Create quiz error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff views their quizzes with submission counts
app.get('/api/staff/quizzes', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT q.id, q.title, q.description, q.created_at, c.name as class_name,
                    (SELECT COUNT(*) FROM quiz_attempts WHERE quiz_id = q.id) as attempt_count,
                    CASE WHEN q.quiz_password IS NULL OR q.quiz_password = '' THEN 0 ELSE 1 END as has_password
             FROM quizzes q
             JOIN classes c ON q.class_id = c.id
             WHERE q.staff_id = ?
             ORDER BY q.created_at DESC`,
            [req.session.user.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff views quiz results (student scores) for a specific quiz
app.get('/api/staff/quiz/:id/results', checkAuth(['staff']), async (req, res) => {
    try {
        const [quizRows] = await pool.query('SELECT title FROM quizzes WHERE id = ? AND staff_id = ?', [req.params.id, req.session.user.id]);
        if (quizRows.length === 0) return res.status(404).json({ error: 'Quiz not found or unauthorized' });

        const [rows] = await pool.query(
            `SELECT u.id, u.username, s.full_name, qa.score, qa.total_questions, qa.submitted_at
             FROM quiz_attempts qa
             JOIN users u ON qa.student_id = u.id
             LEFT JOIN student_details s ON u.id = s.user_id
             WHERE qa.quiz_id = ?
             ORDER BY u.username ASC`,
            [req.params.id]
        );

        // Also get total students in class
        const [quizInfo] = await pool.query('SELECT class_id FROM quizzes WHERE id = ?', [req.params.id]);
        let totalStudents = 0;
        if (quizInfo.length > 0) {
            const [countRows] = await pool.query('SELECT COUNT(*) as count FROM student_details WHERE class_id = ?', [quizInfo[0].class_id]);
            totalStudents = countRows[0].count;
        }

        res.json({
            quizTitle: quizRows[0].title,
            attempts: rows,
            total: totalStudents,
            submitted: rows.length
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Student views quizzes for their class
app.get('/api/student/quizzes', checkAuth(['student']), async (req, res) => {
    try {
        const [studentClass] = await pool.query('SELECT class_id FROM student_details WHERE user_id = ?', [req.session.user.id]);
        if (studentClass.length === 0 || !studentClass[0].class_id) {
            return res.status(400).json({ error: 'Please complete your profile first.' });
        }

        const [rows] = await pool.query(
            `SELECT q.id, q.title, q.description, q.created_at, u.username as staff_name,
                    (SELECT COUNT(*) FROM quiz_attempts WHERE quiz_id = q.id AND student_id = ?) as has_attempted,
                    CASE WHEN q.quiz_password IS NULL OR q.quiz_password = '' THEN 0 ELSE 1 END as has_password
             FROM quizzes q
             JOIN users u ON q.staff_id = u.id
             WHERE q.class_id = ?
             ORDER BY q.created_at DESC`,
            [req.session.user.id, studentClass[0].class_id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Student gets quiz questions for attempting
app.get('/api/student/quiz/:id', checkAuth(['student']), async (req, res) => {
    try {
        // Check if student already attempted
        const [attemptRows] = await pool.query('SELECT id FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?', [req.params.id, req.session.user.id]);
        if (attemptRows.length > 0) {
            return res.status(400).json({ error: 'You have already attempted this quiz' });
        }

        // Get quiz info
        const [quizRows] = await pool.query(
            'SELECT q.id, q.title, q.description FROM quizzes q JOIN student_details s ON q.class_id = s.class_id WHERE q.id = ? AND s.user_id = ?',
            [req.params.id, req.session.user.id]
        );
        if (quizRows.length === 0) return res.status(404).json({ error: 'Quiz not found' });

        // Get questions (without correct_answer)
        const [questions] = await pool.query(
            'SELECT id, question_text, option_a, option_b, option_c, option_d FROM quiz_questions WHERE quiz_id = ? ORDER BY id ASC',
            [req.params.id]
        );

        res.json({
            quiz: quizRows[0],
            questions
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Student starts a (possibly password-gated) quiz
// If the quiz has a password set, students must supply it to get the questions.
app.post('/api/student/quiz/:id/start', checkAuth(['student']), async (req, res) => {
    try {
        const { password } = req.body;

        // Check if student already attempted
        const [attemptRows] = await pool.query('SELECT id FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?', [req.params.id, req.session.user.id]);
        if (attemptRows.length > 0) {
            return res.status(400).json({ error: 'You have already attempted this quiz' });
        }

        // Get quiz info (with password + class check)
        const [quizRows] = await pool.query(
            'SELECT q.id, q.title, q.description, q.quiz_password FROM quizzes q JOIN student_details s ON q.class_id = s.class_id WHERE q.id = ? AND s.user_id = ?',
            [req.params.id, req.session.user.id]
        );
        if (quizRows.length === 0) return res.status(404).json({ error: 'Quiz not found' });
        const quiz = quizRows[0];

        // Password gate (only if the staff set a password)
        if (quiz.quiz_password) {
            if (!password) {
                return res.status(403).json({ error: 'This quiz is password protected. Enter the password to continue.' });
            }
            if (password !== quiz.quiz_password) {
                return res.status(403).json({ error: 'Incorrect password' });
            }
        }

        // Get questions (without correct_answer)
        const [questions] = await pool.query(
            'SELECT id, question_text, option_a, option_b, option_c, option_d FROM quiz_questions WHERE quiz_id = ? ORDER BY id ASC',
            [req.params.id]
        );

        res.json({
            quiz: { id: quiz.id, title: quiz.title, description: quiz.description },
            questions
        });
    } catch (err) {
        console.error('Start quiz error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Student submits quiz answers
app.post('/api/student/quiz/:id/submit', checkAuth(['student']), async (req, res) => {
    try {
        const { answers } = req.body; // answers: { questionId: 'a'|'b'|'c'|'d', ... }

        // Check if already attempted
        const [attemptRows] = await pool.query('SELECT id FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?', [req.params.id, req.session.user.id]);
        if (attemptRows.length > 0) {
            return res.status(400).json({ error: 'You have already attempted this quiz' });
        }

        // Get quiz questions with correct answers
        const [questions] = await pool.query(
            'SELECT id, correct_answer FROM quiz_questions WHERE quiz_id = ?',
            [req.params.id]
        );

        if (questions.length === 0) {
            return res.status(400).json({ error: 'No questions found for this quiz' });
        }

        // Calculate score
        let score = 0;
        const totalQuestions = questions.length;
        const answerDetails = [];

        for (const q of questions) {
            const studentAnswer = answers && answers[q.id] ? answers[q.id] : '';
            const isCorrect = studentAnswer === q.correct_answer;
            if (isCorrect) score++;
            answerDetails.push({
                questionId: q.id,
                correctAnswer: q.correct_answer,
                studentAnswer: studentAnswer,
                isCorrect
            });
        }

        await pool.query(
            'INSERT INTO quiz_attempts (quiz_id, student_id, score, total_questions, answers) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, req.session.user.id, score, totalQuestions, JSON.stringify(answerDetails)]
        );

        res.json({ message: 'Quiz submitted successfully', score, total: totalQuestions });
    } catch (err) {
        console.error('Submit quiz error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Student views their result for a quiz
app.get('/api/student/quiz/:id/result', checkAuth(['student']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT qa.score, qa.total_questions, qa.answers, qa.submitted_at, q.title, q.description
             FROM quiz_attempts qa
             JOIN quizzes q ON qa.quiz_id = q.id
             WHERE qa.quiz_id = ? AND qa.student_id = ?`,
            [req.params.id, req.session.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'No attempt found' });

        const result = rows[0];
        result.answers = typeof result.answers === 'string' ? JSON.parse(result.answers) : result.answers;

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/staff/assignment', checkAuth(['staff']), async (req, res) => {
    try {
        const { title, description, class_id, max_marks, due_date } = req.body;
        if (!title || !class_id) {
            return res.status(400).json({ error: 'Title and class are required' });
        }
        const marks = max_marks || 100;
        await pool.query(
            'INSERT INTO assignments (title, description, class_id, staff_id, max_marks, due_date) VALUES (?, ?, ?, ?, ?, ?)',
            [title, description || '', class_id, req.session.user.id, marks, due_date || null]
        );
        res.json({ message: 'Assignment created successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff views assignments they created (with submission summary)
app.get('/api/staff/assignments', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.id, a.title, a.description, a.created_at, c.name as class_name, a.max_marks, a.due_date,
                    (SELECT COUNT(*) FROM assignment_submissions WHERE assignment_id = a.id) as submission_count,
                    (SELECT COUNT(*) FROM assignment_submissions WHERE assignment_id = a.id AND marks IS NOT NULL) as graded_count,
                    (SELECT COUNT(*) FROM assignment_submissions WHERE assignment_id = a.id AND submitted_at <= a.due_date) as on_time_count,
                    (SELECT COUNT(*) FROM assignment_submissions WHERE assignment_id = a.id AND submitted_at > a.due_date) as late_count
             FROM assignments a
             JOIN classes c ON a.class_id = c.id
             WHERE a.staff_id = ?
             ORDER BY a.created_at DESC`,
            [req.session.user.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff views submission details for an assignment (D numbers in ascending order)
app.get('/api/staff/assignment/:id/submissions', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT asub.id as submission_id, u.id as student_user_id, u.username, s.full_name, asub.file_url, asub.submitted_at,
                    asub.marks, asub.feedback, asub.graded_at, asub.graded_by
             FROM assignment_submissions asub
             JOIN users u ON asub.student_id = u.id
             LEFT JOIN student_details s ON u.id = s.user_id
             WHERE asub.assignment_id = ?
             ORDER BY u.username ASC`,
            [req.params.id]
        );
        
        // Also get total student count for this assignment's class
        const [assignmentRows] = await pool.query(
            'SELECT class_id, max_marks, due_date FROM assignments WHERE id = ?',
            [req.params.id]
        );
        
        let totalStudents = 0;
        let maxMarks = 100;
        let dueDate = null;
        if (assignmentRows.length > 0) {
            const [countRows] = await pool.query(
                'SELECT COUNT(*) as count FROM student_details WHERE class_id = ?',
                [assignmentRows[0].class_id]
            );
            totalStudents = countRows[0].count;
            maxMarks = assignmentRows[0].max_marks || 100;
            dueDate = assignmentRows[0].due_date;
        }
        
        // Add is_on_time flag to each submission
        const submissionsWithTiming = rows.map(sub => {
            let is_on_time = null;
            if (dueDate) {
                is_on_time = new Date(sub.submitted_at) <= new Date(dueDate);
            }
            return { ...sub, is_on_time };
        });
        
        res.json({ submissions: submissionsWithTiming, total: totalStudents, submitted: rows.length, max_marks: maxMarks, due_date: dueDate });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff grades an assignment submission
app.post('/api/staff/submission/:id/grade', checkAuth(['staff']), async (req, res) => {
    try {
        const { marks, feedback } = req.body;
        const submissionId = req.params.id;
        
        if (marks === undefined || marks === null || marks === '') {
            return res.status(400).json({ error: 'Marks are required' });
        }
        
        // Validate marks is a number and within the assignment's max marks
        const marksNum = parseFloat(marks);
        if (isNaN(marksNum)) {
            return res.status(400).json({ error: 'Marks must be a number' });
        }

        // Get the assignment's max marks and verify staff owns this assignment
        const [submissionRows] = await pool.query(
            `SELECT asub.id, a.id as assignment_id, a.staff_id, a.max_marks
             FROM assignment_submissions asub
             JOIN assignments a ON asub.assignment_id = a.id
             WHERE asub.id = ?`,
            [submissionId]
        );

        if (submissionRows.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        if (submissionRows[0].staff_id !== req.session.user.id) {
            return res.status(403).json({ error: 'Not authorized to grade this submission' });
        }

        const maxMarks = parseFloat(submissionRows[0].max_marks || 100);
        if (marksNum < 0 || marksNum > maxMarks) {
            return res.status(400).json({ error: `Marks must be between 0 and ${maxMarks}` });
        }

        await pool.query(
            'UPDATE assignment_submissions SET marks = ?, feedback = ?, graded_by = ?, graded_at = CURRENT_TIMESTAMP WHERE id = ?',
            [marksNum, feedback || null, req.session.user.id, submissionId]
        );

        res.json({ message: 'Submission graded successfully' });
    } catch (err) {
        console.error('Grade submission error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff clears a grade for a submission
app.delete('/api/staff/submission/:id/grade', checkAuth(['staff']), async (req, res) => {
    try {
        const submissionId = req.params.id;

        // Verify staff owns this assignment
        const [submissionRows] = await pool.query(
            `SELECT asub.id, a.staff_id
             FROM assignment_submissions asub
             JOIN assignments a ON asub.assignment_id = a.id
             WHERE asub.id = ?`,
            [submissionId]
        );

        if (submissionRows.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }

        if (submissionRows[0].staff_id !== req.session.user.id) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        await pool.query(
            'UPDATE assignment_submissions SET marks = NULL, feedback = NULL, graded_by = NULL, graded_at = NULL WHERE id = ?',
            [submissionId]
        );

        res.json({ message: 'Grade removed' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Student views assignments for their class
app.get('/api/student/assignments', checkAuth(['student']), async (req, res) => {
    try {
        const [studentClass] = await pool.query('SELECT class_id FROM student_details WHERE user_id = ?', [req.session.user.id]);
        if (studentClass.length === 0 || !studentClass[0].class_id) {
            return res.status(400).json({ error: 'Please complete your profile first.' });
        }
        
        const [rows] = await pool.query(
            `SELECT a.id, a.title, a.description, a.created_at, u.username as staff_name, a.max_marks, a.due_date,
                    (SELECT COUNT(*) FROM assignment_submissions WHERE assignment_id = a.id AND student_id = ?) as has_submitted,
                    (SELECT marks FROM assignment_submissions WHERE assignment_id = a.id AND student_id = ?) as my_marks,
                    (SELECT feedback FROM assignment_submissions WHERE assignment_id = a.id AND student_id = ?) as my_feedback
             FROM assignments a
             JOIN users u ON a.staff_id = u.id
             WHERE a.class_id = ?
             ORDER BY a.created_at DESC`,
            [req.session.user.id, req.session.user.id, req.session.user.id, studentClass[0].class_id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Student submits an assignment
app.post('/api/student/submit-assignment', checkAuth(['student']), async (req, res) => {
    try {
        const { assignment_id } = req.body;
        
        if (!assignment_id) {
            return res.status(400).json({ error: 'Assignment ID required' });
        }
        
        if (!req.files || !req.files.assignmentFile) {
            return res.status(400).json({ error: 'Please upload a file' });
        }
        
        const file = req.files.assignmentFile;
        const filename = 'sub_' + Date.now() + '_' + file.name;
        const uploadPath = path.join(__dirname, 'public/uploads', filename);
        
        await new Promise((resolve, reject) => {
            file.mv(uploadPath, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        const fileUrl = '/uploads/' + filename;
        
        await pool.query(
            'INSERT INTO assignment_submissions (assignment_id, student_id, file_url) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE file_url = ?, submitted_at = CURRENT_TIMESTAMP',
            [assignment_id, req.session.user.id, fileUrl, fileUrl]
        );
        
        res.json({ message: 'Assignment submitted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// =============================================================
// 9. Week Course Routes (Staff & Student)
// =============================================================
// A Course spans a number of weeks. Staff can create a course, then
// add weekly assignments (with due dates + file-type restrictions)
// and weekly quizzes (password-gated). A course is visible to a
// specific class, or to ALL classes when class_id is NULL.

// ---- Staff: Course CRUD ----

// Staff lists all courses they created
app.get('/api/staff/courses', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT c.id, c.title, c.description, c.total_weeks, c.created_at,
                    c.class_id, cl.name as class_name,
                    (SELECT COUNT(*) FROM week_assignments WHERE course_id = c.id) as assignment_count,
                    (SELECT COUNT(*) FROM week_quizzes WHERE course_id = c.id) as quiz_count
             FROM courses c
             LEFT JOIN classes cl ON c.class_id = cl.id
             WHERE c.staff_id = ?
             ORDER BY c.created_at DESC`,
            [req.session.user.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff creates a new course
app.post('/api/staff/course', checkAuth(['staff']), async (req, res) => {
    const { title, description, total_weeks, class_id } = req.body;
    if (!title || !total_weeks) {
        return res.status(400).json({ error: 'Title and number of weeks are required' });
    }
    const weeks = parseInt(total_weeks);
    if (isNaN(weeks) || weeks < 1) {
        return res.status(400).json({ error: 'Number of weeks must be a positive integer' });
    }
    try {
        await pool.query(
            'INSERT INTO courses (title, description, total_weeks, class_id, staff_id) VALUES (?, ?, ?, ?, ?)',
            [title, description || '', weeks, class_id || null, req.session.user.id]
        );
        res.json({ message: 'Course created successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff deletes a course
app.delete('/api/staff/course/:id', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id FROM courses WHERE id = ? AND staff_id = ?', [req.params.id, req.session.user.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Course not found or unauthorized' });
        await pool.query('DELETE FROM courses WHERE id = ?', [req.params.id]);
        res.json({ message: 'Course deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff gets full course detail (weeks, assignments, quizzes)
app.get('/api/staff/course/:id', checkAuth(['staff']), async (req, res) => {
    try {
        const [course] = await pool.query(
            `SELECT c.id, c.title, c.description, c.total_weeks, c.class_id, c.staff_id, c.created_at,
                    cl.name as class_name
             FROM courses c
             LEFT JOIN classes cl ON c.class_id = cl.id
             WHERE c.id = ? AND c.staff_id = ?`,
            [req.params.id, req.session.user.id]
        );
        if (course.length === 0) return res.status(404).json({ error: 'Course not found or unauthorized' });

        const [assignments] = await pool.query(
            `SELECT wa.id, wa.week_number, wa.title, wa.description, wa.due_date,
                    wa.file_type, wa.max_marks, wa.created_at
             FROM week_assignments wa
             WHERE wa.course_id = ?
             ORDER BY wa.week_number ASC, wa.created_at DESC`,
            [req.params.id]
        );

        const [quizzes] = await pool.query(
            `SELECT wq.id, wq.week_number, wq.title, wq.description, wq.quiz_password,
                    (SELECT COUNT(*) FROM week_quiz_questions WHERE quiz_id = wq.id) as question_count,
                    (SELECT COUNT(*) FROM week_quiz_attempts WHERE quiz_id = wq.id) as attempt_count
             FROM week_quizzes wq
             WHERE wq.course_id = ?
             ORDER BY wq.week_number ASC, wq.created_at DESC`,
            [req.params.id]
        );

        const [materials] = await pool.query(
            `SELECT id, week_number, title, description, file_url, created_at
             FROM week_materials WHERE course_id = ? ORDER BY week_number ASC, created_at DESC`,
            [req.params.id]
        );

        res.json({ course: course[0], assignments, quizzes, materials });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ---- Staff: Week Assignments ----

// Staff creates a week assignment
app.post('/api/staff/course/:id/assignment', checkAuth(['staff']), async (req, res) => {
    const { week_number, title, description, due_date, file_type, max_marks } = req.body;
    if (!week_number || !title) {
        return res.status(400).json({ error: 'Week number and title are required' });
    }
    try {
        const [courseCheck] = await pool.query('SELECT id FROM courses WHERE id = ? AND staff_id = ?', [req.params.id, req.session.user.id]);
        if (courseCheck.length === 0) return res.status(404).json({ error: 'Course not found or unauthorized' });

        await pool.query(
            'INSERT INTO week_assignments (course_id, staff_id, week_number, title, description, due_date, file_type, max_marks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [req.params.id, req.session.user.id, week_number, title, description || '', due_date || null, file_type || 'any', max_marks || 100]
        );
        res.json({ message: 'Week assignment created successfully' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'An assignment already exists for this week' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff deletes a week assignment
app.delete('/api/staff/week-assignment/:id', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT wa.id FROM week_assignments wa JOIN courses c ON wa.course_id = c.id WHERE wa.id = ? AND c.staff_id = ?`,
            [req.params.id, req.session.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Assignment not found or unauthorized' });

        const [subs] = await pool.query('SELECT file_url FROM week_assignment_submissions WHERE assignment_id = ?', [req.params.id]);
        const fs = require('fs');
        subs.forEach(s => {
            const filePath = path.join(__dirname, 'public', s.file_url);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        });

        await pool.query('DELETE FROM week_assignments WHERE id = ?', [req.params.id]);
        res.json({ message: 'Assignment deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff views submissions for a week assignment
app.get('/api/staff/week-assignment/:id/submissions', checkAuth(['staff']), async (req, res) => {
    try {
        const [asnRows] = await pool.query(
            `SELECT wa.id, wa.title, wa.max_marks, wa.due_date, wa.file_type, c.class_id
             FROM week_assignments wa JOIN courses c ON wa.course_id = c.id
             WHERE wa.id = ? AND c.staff_id = ?`,
            [req.params.id, req.session.user.id]
        );
        if (asnRows.length === 0) return res.status(404).json({ error: 'Assignment not found or unauthorized' });

        const assignmentInfo = asnRows[0];

        const [rows] = await pool.query(
            `SELECT was.id as submission_id, was.student_id as student_user_id, u.username, s.full_name,
                    was.file_url, was.submitted_at, was.marks, was.feedback, was.graded_at, was.graded_by
             FROM week_assignment_submissions was
             JOIN users u ON was.student_id = u.id
             LEFT JOIN student_details s ON u.id = s.user_id
             WHERE was.assignment_id = ?
             ORDER BY u.username ASC`,
            [req.params.id]
        );

        let totalStudents = 0;
        if (assignmentInfo.class_id) {
            const [countRows] = await pool.query('SELECT COUNT(*) as count FROM student_details WHERE class_id = ?', [assignmentInfo.class_id]);
            totalStudents = countRows[0].count;
        } else {
            const [countRows] = await pool.query(
                `SELECT COUNT(*) as count FROM users u JOIN student_details s ON u.id = s.user_id WHERE u.is_approved = 1`
            );
            totalStudents = countRows[0].count;
        }

        const submissions = rows.map(sub => {
            let is_on_time = null;
            if (assignmentInfo.due_date) {
                is_on_time = new Date(sub.submitted_at) <= new Date(assignmentInfo.due_date);
            }
            return { ...sub, is_on_time };
        });

        res.json({
            submissions: submissions,
            total: totalStudents,
            submitted: rows.length,
            max_marks: assignmentInfo.max_marks,
            due_date: assignmentInfo.due_date,
            file_type: assignmentInfo.file_type,
            assignment_title: assignmentInfo.title
        });
    } catch (err) {
        console.error('Week assignment submissions error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff grades a week assignment submission
app.post('/api/staff/week-submission/:id/grade', checkAuth(['staff']), async (req, res) => {
    try {
        const { marks, feedback } = req.body;
        const submissionId = req.params.id;

        if (marks === undefined || marks === null || marks === '') {
            return res.status(400).json({ error: 'Marks are required' });
        }
        const marksNum = parseFloat(marks);
        if (isNaN(marksNum)) {
            return res.status(400).json({ error: 'Marks must be a number' });
        }

        const [submissionRows] = await pool.query(
            `SELECT was.id, wa.max_marks, c.staff_id
             FROM week_assignment_submissions was
             JOIN week_assignments wa ON was.assignment_id = wa.id
             JOIN courses c ON wa.course_id = c.id
             WHERE was.id = ?`,
            [submissionId]
        );

        if (submissionRows.length === 0) return res.status(404).json({ error: 'Submission not found' });
        if (submissionRows[0].staff_id !== req.session.user.id) return res.status(403).json({ error: 'Not authorized' });

        const maxMarks = parseFloat(submissionRows[0].max_marks || 100);
        if (marksNum < 0 || marksNum > maxMarks) {
            return res.status(400).json({ error: `Marks must be between 0 and ${maxMarks}` });
        }

        await pool.query(
            'UPDATE week_assignment_submissions SET marks = ?, feedback = ?, graded_by = ?, graded_at = CURRENT_TIMESTAMP WHERE id = ?',
            [marksNum, feedback || null, req.session.user.id, submissionId]
        );
        res.json({ message: 'Submission graded successfully' });
    } catch (err) {
        console.error('Grade week submission error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff clears a grade for a week assignment submission
app.delete('/api/staff/week-submission/:id/grade', checkAuth(['staff']), async (req, res) => {
    try {
        const submissionId = req.params.id;
        const [submissionRows] = await pool.query(
            `SELECT was.id FROM week_assignment_submissions was
             JOIN week_assignments wa ON was.assignment_id = wa.id
             JOIN courses c ON wa.course_id = c.id
             WHERE was.id = ? AND c.staff_id = ?`,
            [submissionId, req.session.user.id]
        );
        if (submissionRows.length === 0) return res.status(404).json({ error: 'Submission not found or unauthorized' });

        await pool.query(
            'UPDATE week_assignment_submissions SET marks = NULL, feedback = NULL, graded_by = NULL, graded_at = NULL WHERE id = ?',
            [submissionId]
        );
        res.json({ message: 'Grade removed' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ---- Staff: Week Quizzes ----

// Staff creates a week quiz (with questions) and sets the password that students
// must enter to unlock/see the quiz.
app.post('/api/staff/course/:id/quiz', checkAuth(['staff']), async (req, res) => {
    const { week_number, title, description, quiz_password, questions } = req.body;
    if (!week_number || !title) {
        return res.status(400).json({ error: 'Week number and title are required' });
    }
    if (!questions || questions.length === 0) {
        return res.status(400).json({ error: 'At least one question is required' });
    }
    try {
        const [courseCheck] = await pool.query('SELECT id FROM courses WHERE id = ? AND staff_id = ?', [req.params.id, req.session.user.id]);
        if (courseCheck.length === 0) return res.status(404).json({ error: 'Course not found or unauthorized' });

        const [quizResult] = await pool.query(
            'INSERT INTO week_quizzes (course_id, staff_id, week_number, title, description, quiz_password) VALUES (?, ?, ?, ?, ?, ?)',
            [req.params.id, req.session.user.id, week_number, title, description || '', quiz_password || null]
        );
        const quizId = quizResult.insertId;

        for (const q of questions) {
            if (!q.question_text || !q.option_a || !q.option_b || !q.option_c || !q.option_d || !q.correct_answer) {
                await pool.query('DELETE FROM week_quizzes WHERE id = ?', [quizId]);
                return res.status(400).json({ error: 'All question fields are required' });
            }
            await pool.query(
                'INSERT INTO week_quiz_questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_answer) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [quizId, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer]
            );
        }
        res.json({ message: 'Week quiz created successfully', quizId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'A quiz already exists for this week' });
        }
        console.error('Create week quiz error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff views week quiz results (student scores)
app.get('/api/staff/week-quiz/:id/results', checkAuth(['staff']), async (req, res) => {
    try {
        const [quizRows] = await pool.query(
            'SELECT wq.id, wq.title FROM week_quizzes wq JOIN courses c ON wq.course_id = c.id WHERE wq.id = ? AND c.staff_id = ?',
            [req.params.id, req.session.user.id]
        );
        if (quizRows.length === 0) return res.status(404).json({ error: 'Quiz not found or unauthorized' });

        const [rows] = await pool.query(
            `SELECT a.id as attempt_id, u.id as student_user_id, u.username, s.full_name,
                    a.score, a.total_questions, a.submitted_at
             FROM week_quiz_attempts a
             JOIN users u ON a.student_id = u.id
             LEFT JOIN student_details s ON u.id = s.user_id
             WHERE a.quiz_id = ?
             ORDER BY u.username ASC`,
            [req.params.id]
        );

        const [quizInfo] = await pool.query(
            `SELECT c.class_id FROM week_quizzes wq JOIN courses c ON wq.course_id = c.id WHERE wq.id = ?`,
            [req.params.id]
        );
        let totalStudents = 0;
        if (quizInfo.length > 0) {
            if (quizInfo[0].class_id) {
                const [countRows] = await pool.query('SELECT COUNT(*) as count FROM student_details WHERE class_id = ?', [quizInfo[0].class_id]);
                totalStudents = countRows[0].count;
            } else {
                const [countRows] = await pool.query(
                    `SELECT COUNT(*) as count FROM users u JOIN student_details s ON u.id = s.user_id WHERE u.is_approved = 1`
                );
                totalStudents = countRows[0].count;
            }
        }

        res.json({ quizTitle: quizRows[0].title, attempts: rows, total: totalStudents, submitted: rows.length });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff deletes a week quiz
app.delete('/api/staff/week-quiz/:id', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT wq.id FROM week_quizzes wq JOIN courses c ON wq.course_id = c.id WHERE wq.id = ? AND c.staff_id = ?`,
            [req.params.id, req.session.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Quiz not found or unauthorized' });
        await pool.query('DELETE FROM week_quizzes WHERE id = ?', [req.params.id]);
        res.json({ message: 'Week quiz deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ---- Staff & Student: Week Materials ----

// Staff uploads a material to a specific week of their course
app.post('/api/staff/course/:id/week/:week/material', checkAuth(['staff']), async (req, res) => {
    try {
        const { title, description } = req.body;
        const courseId = req.params.id;
        const week = parseInt(req.params.week);
        if (!title) return res.status(400).json({ error: 'Title is required' });
        if (!week || week < 1) return res.status(400).json({ error: 'Valid week number is required' });
        if (!req.files || !req.files.materialFile) return res.status(400).json({ error: 'Please upload a file' });
        const [courseCheck] = await pool.query('SELECT id FROM courses WHERE id = ? AND staff_id = ?', [courseId, req.session.user.id]);
        if (courseCheck.length === 0) return res.status(404).json({ error: 'Course not found or unauthorized' });
        const file = req.files.materialFile;
        const filename = 'week_mat_' + Date.now() + '_' + file.name;
        const uploadPath = path.join(__dirname, 'public/uploads', filename);
        file.mv(uploadPath, async (err) => {
            if (err) return res.status(500).json({ error: err.message });
            try {
                await pool.query(
                    'INSERT INTO week_materials (course_id, week_number, title, description, file_url, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
                    [courseId, week, title, description || null, '/uploads/' + filename, req.session.user.id]
                );
                res.json({ message: 'Material added successfully' });
            } catch (dbErr) {
                res.status(500).json({ error: 'Server error' });
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff lists all materials for their course
app.get('/api/staff/course/:id/materials', checkAuth(['staff']), async (req, res) => {
    try {
        const [courseCheck] = await pool.query('SELECT id FROM courses WHERE id = ? AND staff_id = ?', [req.params.id, req.session.user.id]);
        if (courseCheck.length === 0) return res.status(404).json({ error: 'Course not found or unauthorized' });
        const [rows] = await pool.query(
            'SELECT id, week_number, title, description, file_url, created_at FROM week_materials WHERE course_id = ? ORDER BY week_number ASC, created_at DESC',
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff deletes a week material
app.delete('/api/staff/week-material/:id', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT wm.file_url FROM week_materials wm JOIN courses c ON wm.course_id = c.id WHERE wm.id = ? AND c.staff_id = ?',
            [req.params.id, req.session.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Material not found or unauthorized' });
        const filePath = path.join(__dirname, 'public', rows[0].file_url);
        const fs = require('fs');
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        await pool.query('DELETE FROM week_materials WHERE id = ?', [req.params.id]);
        res.json({ message: 'Material deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Student lists materials for a course they can access (respects class visibility)
app.get('/api/student/course/:id/materials', checkAuth(['student']), async (req, res) => {
    try {
        const [studentClass] = await pool.query('SELECT class_id FROM student_details WHERE user_id = ?', [req.session.user.id]);
        const studentClassId = studentClass.length > 0 ? studentClass[0].class_id : null;
        const [courseCheck] = await pool.query(
            'SELECT id FROM courses WHERE id = ? AND (class_id IS NULL OR class_id = ?)',
            [req.params.id, studentClassId]
        );
        if (courseCheck.length === 0) return res.status(404).json({ error: 'Course not found' });
        const [rows] = await pool.query(
            'SELECT id, week_number, title, description, file_url FROM week_materials WHERE course_id = ? ORDER BY week_number ASC, created_at DESC',
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});



// ---- Student: Course visibility & submission ----

// Student gets courses visible to them (class match, or all if class_id is NULL)
app.get('/api/student/courses', checkAuth(['student']), async (req, res) => {
    try {
        const [studentClass] = await pool.query('SELECT class_id FROM student_details WHERE user_id = ?', [req.session.user.id]);
        const studentClassId = studentClass.length > 0 ? studentClass[0].class_id : null;

        const [rows] = await pool.query(
            `SELECT c.id, c.title, c.description, c.total_weeks, c.created_at,
                    c.class_id, cl.name as class_name, u.username as staff_name
             FROM courses c
             LEFT JOIN classes cl ON c.class_id = cl.id
             JOIN users u ON c.staff_id = u.id
             WHERE c.class_id IS NULL OR c.class_id = ?
             ORDER BY c.created_at DESC`,
            [studentClassId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Student gets a course detail (weeks, assignments with submission status,
// quizzes with attempt/password status — password is never returned here)
app.get('/api/student/course/:id', checkAuth(['student']), async (req, res) => {
    try {
        const [studentClass] = await pool.query('SELECT class_id FROM student_details WHERE user_id = ?', [req.session.user.id]);
        const studentClassId = studentClass.length > 0 ? studentClass[0].class_id : null;

        const [courseRows] = await pool.query(
            `SELECT c.id, c.title, c.description, c.total_weeks, c.created_at, cl.name as class_name, u.username as staff_name
             FROM courses c
             LEFT JOIN classes cl ON c.class_id = cl.id
             JOIN users u ON c.staff_id = u.id
             WHERE c.id = ? AND (c.class_id IS NULL OR c.class_id = ?)`,
            [req.params.id, studentClassId]
        );
        if (courseRows.length === 0) return res.status(404).json({ error: 'Course not found' });

        const course = courseRows[0];

        const [assignments] = await pool.query(
            `SELECT wa.id, wa.week_number, wa.title, wa.description, wa.due_date,
                    wa.file_type, wa.max_marks, wa.created_at,
                    (SELECT COUNT(*) FROM week_assignment_submissions WHERE assignment_id = wa.id AND student_id = ?) as has_submitted,
                    (SELECT file_url FROM week_assignment_submissions WHERE assignment_id = wa.id AND student_id = ?) as my_file_url,
                    (SELECT marks FROM week_assignment_submissions WHERE assignment_id = wa.id AND student_id = ?) as my_marks,
                    (SELECT feedback FROM week_assignment_submissions WHERE assignment_id = wa.id AND student_id = ?) as my_feedback
             FROM week_assignments wa
             WHERE wa.course_id = ?
             ORDER BY wa.week_number ASC, wa.created_at DESC`,
            [req.session.user.id, req.session.user.id, req.session.user.id, req.session.user.id, req.params.id]
        );

        const [quizzes] = await pool.query(
            `SELECT wq.id, wq.week_number, wq.title, wq.description, wq.created_at,
                    (SELECT COUNT(*) FROM week_quiz_questions WHERE quiz_id = wq.id) as question_count,
                    (SELECT COUNT(*) FROM week_quiz_attempts WHERE quiz_id = wq.id AND student_id = ?) as has_attempted,
                    CASE WHEN wq.quiz_password IS NULL OR wq.quiz_password = '' THEN 0 ELSE 1 END as has_password
             FROM week_quizzes wq
             WHERE wq.course_id = ?
             ORDER BY wq.week_number ASC, wq.created_at DESC`,
            [req.session.user.id, req.params.id]
        );

        res.json({ course, assignments, quizzes });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Student submits a week assignment (validates allowed file type)
app.post('/api/student/submit-week-assignment', checkAuth(['student']), async (req, res) => {
    try {
        const { assignment_id } = req.body;
        if (!assignment_id) return res.status(400).json({ error: 'Assignment ID required' });
        if (!req.files || !req.files.assignmentFile) return res.status(400).json({ error: 'Please upload a file' });

        // Get assignment file-type restriction + course visibility check
        const [asnRows] = await pool.query(
            `SELECT wa.file_type, wa.course_id, c.class_id
             FROM week_assignments wa JOIN courses c ON wa.course_id = c.id
             WHERE wa.id = ?`,
            [assignment_id]
        );
        if (asnRows.length === 0) return res.status(404).json({ error: 'Assignment not found' });
        const asn = asnRows[0];

        // Enforce class visibility
        const [studentClass] = await pool.query('SELECT class_id FROM student_details WHERE user_id = ?', [req.session.user.id]);
        const studentClassId = studentClass.length > 0 ? studentClass[0].class_id : null;
        if (asn.class_id && asn.class_id !== studentClassId) {
            return res.status(403).json({ error: 'This assignment is not available for your class' });
        }

        // Validate file type
        const file = req.files.assignmentFile;
        const ext = path.extname(file.name).toLowerCase().replace('.', '');
        const allowedTypes = {
            pdf: ['pdf'],
            csv: ['csv'],
            mp4: ['mp4'],
            any: ['pdf', 'csv', 'mp4', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'zip', 'ppt', 'pptx']
        };
        const allowed = allowedTypes[asn.file_type] || allowedTypes.any;
        if (!allowed.includes(ext)) {
            return res.status(400).json({
                error: `This assignment only accepts ${asn.file_type === 'any' ? 'any file' : asn.file_type.toUpperCase() + ' files'}. Uploaded extension: ${ext || '(none)'}`
            });
        }

        const filename = 'week_sub_' + Date.now() + '_' + file.name;
        const uploadPath = path.join(__dirname, 'public/uploads', filename);
        await new Promise((resolve, reject) => {
            file.mv(uploadPath, (err) => { if (err) reject(err); else resolve(); });
        });

        const fileUrl = '/uploads/' + filename;
        await pool.query(
            'INSERT INTO week_assignment_submissions (assignment_id, student_id, file_url) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE file_url = ?, submitted_at = CURRENT_TIMESTAMP',
            [assignment_id, req.session.user.id, fileUrl, fileUrl]
        );
        res.json({ message: 'Assignment submitted successfully' });
    } catch (err) {
        console.error('Submit week assignment error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Student starts a week quiz — must supply the correct password.
// On success returns the quiz + questions (only if not already attempted).
app.post('/api/student/week-quiz/:id/start', checkAuth(['student']), async (req, res) => {
    try {
        const { password } = req.body;

        const [quizRows] = await pool.query(
            `SELECT wq.id, wq.title, wq.description, wq.quiz_password, wq.course_id, c.class_id
             FROM week_quizzes wq JOIN courses c ON wq.course_id = c.id
             WHERE wq.id = ?`,
            [req.params.id]
        );
        if (quizRows.length === 0) return res.status(404).json({ error: 'Quiz not found' });
        const quiz = quizRows[0];

        // Enforce class visibility
        const [studentClass] = await pool.query('SELECT class_id FROM student_details WHERE user_id = ?', [req.session.user.id]);
        const studentClassId = studentClass.length > 0 ? studentClass[0].class_id : null;
        if (quiz.class_id && quiz.class_id !== studentClassId) {
            return res.status(403).json({ error: 'This quiz is not available for your class' });
        }

        // Already attempted?
        const [attemptRows] = await pool.query('SELECT id FROM week_quiz_attempts WHERE quiz_id = ? AND student_id = ?', [req.params.id, req.session.user.id]);
        if (attemptRows.length > 0) return res.status(400).json({ error: 'You have already attempted this quiz' });

        // Password gate
        if (!quiz.quiz_password) {
            return res.status(400).json({ error: 'Quiz password has not been set by the staff yet' });
        }
        if (password !== quiz.quiz_password) {
            return res.status(403).json({ error: 'Incorrect password' });
        }

        const [questions] = await pool.query(
            'SELECT id, question_text, option_a, option_b, option_c, option_d FROM week_quiz_questions WHERE quiz_id = ? ORDER BY id ASC',
            [req.params.id]
        );
        res.json({ quiz: { id: quiz.id, title: quiz.title, description: quiz.description }, questions });
    } catch (err) {
        console.error('Start week quiz error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Student submits week quiz answers
app.post('/api/student/week-quiz/:id/submit', checkAuth(['student']), async (req, res) => {
    try {
        const { answers } = req.body;

        const [attemptRows] = await pool.query('SELECT id FROM week_quiz_attempts WHERE quiz_id = ? AND student_id = ?', [req.params.id, req.session.user.id]);
        if (attemptRows.length > 0) return res.status(400).json({ error: 'You have already attempted this quiz' });

        const [questions] = await pool.query('SELECT id, correct_answer FROM week_quiz_questions WHERE quiz_id = ?', [req.params.id]);
        if (questions.length === 0) return res.status(400).json({ error: 'No questions found for this quiz' });

        let score = 0;
        const totalQuestions = questions.length;
        const answerDetails = [];
        for (const q of questions) {
            const studentAnswer = answers && answers[q.id] ? answers[q.id] : '';
            const isCorrect = studentAnswer === q.correct_answer;
            if (isCorrect) score++;
            answerDetails.push({ questionId: q.id, correctAnswer: q.correct_answer, studentAnswer, isCorrect });
        }

        await pool.query(
            'INSERT INTO week_quiz_attempts (quiz_id, student_id, score, total_questions, answers) VALUES (?, ?, ?, ?, ?)',
            [req.params.id, req.session.user.id, score, totalQuestions, JSON.stringify(answerDetails)]
        );
        res.json({ message: 'Quiz submitted successfully', score, total: totalQuestions });
    } catch (err) {
        console.error('Submit week quiz error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Student views their result for a week quiz
app.get('/api/student/week-quiz/:id/result', checkAuth(['student']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.score, a.total_questions, a.answers, a.submitted_at, q.title, q.description
             FROM week_quiz_attempts a JOIN week_quizzes q ON a.quiz_id = q.id
             WHERE a.quiz_id = ? AND a.student_id = ?`,
            [req.params.id, req.session.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'No attempt found' });

        const result = rows[0];
        result.answers = typeof result.answers === 'string' ? JSON.parse(result.answers) : result.answers;
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});



// ====================================================
// Leave Management & Mentor Routes
// ====================================================

// Student applies for leave
app.post('/api/student/leave/apply', checkAuth(['student']), async (req, res) => {
    try {
        const { leave_type, reason } = req.body;
        if (!leave_type || !reason) return res.status(400).json({ error: 'Leave type and reason are required' });
        if (!['medical', 'casual', 'emergency'].includes(leave_type)) {
            return res.status(400).json({ error: 'Invalid leave type' });
        }
        // Get student's class
        const [studentRows] = await pool.query('SELECT class_id FROM student_details WHERE user_id = ?', [req.session.user.id]);
        if (studentRows.length === 0 || !studentRows[0].class_id) {
            return res.status(400).json({ error: 'Please complete your profile and select a class first' });
        }
        const classId = studentRows[0].class_id;
        await pool.query(
            'INSERT INTO leave_applications (student_id, class_id, leave_type, reason) VALUES (?, ?, ?, ?)',
            [req.session.user.id, classId, leave_type, reason]
        );
        res.json({ message: 'Leave application submitted successfully' });
    } catch (err) {
        console.error('Leave apply error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Student views their leave applications
app.get('/api/student/leaves', checkAuth(['student']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, leave_type, reason, status, applied_at, reviewed_at, review_remarks
             FROM leave_applications WHERE student_id = ? ORDER BY applied_at DESC`,
            [req.session.user.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff views leave applications for their mentored class
app.get('/api/staff/leaves', checkAuth(['staff']), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT la.id, la.leave_type, la.reason, la.status, la.applied_at, la.review_remarks,
                    u.username as student_username, s.full_name as student_name
             FROM leave_applications la
             JOIN users u ON la.student_id = u.id
             LEFT JOIN student_details s ON u.id = s.user_id
             JOIN classes c ON la.class_id = c.id
             WHERE c.mentor_id = ?
             ORDER BY la.status ASC, la.applied_at DESC`,
            [req.session.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error('Staff leaves error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff approves a leave application
app.put('/api/staff/leave/:id/approve', checkAuth(['staff']), async (req, res) => {
    try {
        const { review_remarks } = req.body || {};
        const [result] = await pool.query(
            `UPDATE leave_applications la
             JOIN classes c ON la.class_id = c.id
             SET la.status = 'approved', la.reviewed_by = ?, la.reviewed_at = CURRENT_TIMESTAMP, la.review_remarks = ?
             WHERE la.id = ? AND c.mentor_id = ? AND la.status = 'pending'`,
            [req.session.user.id, review_remarks || null, req.params.id, req.session.user.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Leave application not found or already processed' });
        res.json({ message: 'Leave approved successfully' });
    } catch (err) {
        console.error('Approve leave error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Staff rejects a leave application
app.put('/api/staff/leave/:id/reject', checkAuth(['staff']), async (req, res) => {
    try {
        const { review_remarks } = req.body || {};
        const [result] = await pool.query(
            `UPDATE leave_applications la
             JOIN classes c ON la.class_id = c.id
             SET la.status = 'rejected', la.reviewed_by = ?, la.reviewed_at = CURRENT_TIMESTAMP, la.review_remarks = ?
             WHERE la.id = ? AND c.mentor_id = ? AND la.status = 'pending'`,
            [req.session.user.id, review_remarks || null, req.params.id, req.session.user.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Leave application not found or already processed' });
        res.json({ message: 'Leave rejected' });
    } catch (err) {
        console.error('Reject leave error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin assigns a mentor (staff) to a class
app.put('/api/admin/class/:id/mentor', checkAuth(['admin']), async (req, res) => {
    try {
        const { mentor_id } = req.body;
        if (!mentor_id) return res.status(400).json({ error: 'Mentor ID is required' });

        // Verify the staff exists and has role 'staff'
        const [staffCheck] = await pool.query('SELECT id, role FROM users WHERE id = ? AND role = "staff"', [mentor_id]);
        if (staffCheck.length === 0) return res.status(400).json({ error: 'Invalid staff member' });

        const [classCheck] = await pool.query('SELECT id FROM classes WHERE id = ?', [req.params.id]);
        if (classCheck.length === 0) return res.status(404).json({ error: 'Class not found' });

        await pool.query('UPDATE classes SET mentor_id = ? WHERE id = ?', [mentor_id, req.params.id]);
        res.json({ message: 'Mentor assigned successfully' });
    } catch (err) {
        console.error('Assign mentor error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin removes mentor from a class
app.delete('/api/admin/class/:id/mentor', checkAuth(['admin']), async (req, res) => {
    try {
        const [result] = await pool.query('UPDATE classes SET mentor_id = NULL WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Class not found' });
        res.json({ message: 'Mentor removed successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Get mentor details for a class (used by student profile)
app.get('/api/student/class-mentor', checkAuth(['student']), async (req, res) => {
    try {
        const [studentRows] = await pool.query('SELECT class_id FROM student_details WHERE user_id = ?', [req.session.user.id]);
        if (studentRows.length === 0 || !studentRows[0].class_id) {
            return res.json({ mentor: null });
        }
        const classId = studentRows[0].class_id;
        const [mentorRows] = await pool.query(
            `SELECT u.id, u.username, sp.full_name, sp.phone, sp.email
             FROM classes c
             JOIN users u ON c.mentor_id = u.id
             LEFT JOIN staff_details sp ON u.id = sp.user_id
             WHERE c.id = ? AND c.mentor_id IS NOT NULL`,
            [classId]
        );
        res.json({ mentor: mentorRows.length > 0 ? mentorRows[0] : null });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});


// Initialize week-course tables on startup (idempotent, self-healing)
async function initDatabase() {
    const conn = await pool.getConnection();
    try {
        // Disable FK checks so tables can be created in any order
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');

        // Ensure prerequisite tables exist (minimal safe definitions)
        await conn.query(`CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role ENUM('admin', 'staff', 'student') NOT NULL,
            is_approved BOOLEAN DEFAULT 0
        )`);
        await conn.query(`CREATE TABLE IF NOT EXISTS classes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            staff_id INT NULL,
            mentor_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (mentor_id) REFERENCES users(id) ON DELETE SET NULL
        )`);
        await conn.query(`CREATE TABLE IF NOT EXISTS staff_details (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL UNIQUE,
            full_name VARCHAR(100),
            staff_id VARCHAR(50),
            age INT,
            aadhaar VARCHAR(20),
            phone VARCHAR(20),
            email VARCHAR(100),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Ensure mentor_id column exists even if classes table was created before this feature
        try { await conn.query('ALTER TABLE classes ADD COLUMN mentor_id INT NULL'); } catch(e) {}
        try { await conn.query('ALTER TABLE classes ADD CONSTRAINT fk_classes_mentor FOREIGN KEY (mentor_id) REFERENCES users(id) ON DELETE SET NULL'); } catch(e) {}

        // Ensure staff_details has all needed columns (older DBs may lack them)
        try { await conn.query('ALTER TABLE staff_details ADD COLUMN email VARCHAR(100) NULL'); } catch(e) {}
        try { await conn.query('ALTER TABLE staff_details ADD COLUMN phone VARCHAR(20) NULL'); } catch(e) {}

        // Ensure the quizzes table exists (it belongs to the original schema)
        await conn.query(`CREATE TABLE IF NOT EXISTS quizzes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            description TEXT,
            class_id INT NOT NULL,
            staff_id INT NOT NULL,
            quiz_password VARCHAR(100) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
            FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE
        )`);
        // Ensure quiz_password column exists even on older databases
        try { await conn.query('ALTER TABLE quizzes ADD COLUMN quiz_password VARCHAR(100) NULL'); } catch(e) {}

        const tables = [
            `CREATE TABLE IF NOT EXISTS courses (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                total_weeks INT NOT NULL DEFAULT 1,
                class_id INT NULL,
                staff_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
                FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS week_materials (
                id INT AUTO_INCREMENT PRIMARY KEY,
                course_id INT NOT NULL,
                week_number INT NOT NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                file_url VARCHAR(500) NOT NULL,
                uploaded_by INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
                FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS leave_applications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                student_id INT NOT NULL,
                class_id INT NOT NULL,
                leave_type ENUM('medical', 'casual', 'emergency') NOT NULL,
                reason TEXT NOT NULL,
                status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reviewed_by INT NULL,
                reviewed_at TIMESTAMP NULL,
                review_remarks TEXT NULL,
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
                FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
            )`,
            `CREATE TABLE IF NOT EXISTS week_assignments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                course_id INT NOT NULL,
                staff_id INT NOT NULL,
                week_number INT NOT NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                due_date DATETIME NULL,
                file_type VARCHAR(20) DEFAULT 'any',
                max_marks INT DEFAULT 100,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_week_assignment (course_id, week_number),
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
                FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS week_assignment_submissions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                assignment_id INT NOT NULL,
                student_id INT NOT NULL,
                file_url VARCHAR(500) NOT NULL,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                marks DECIMAL(5,2) NULL,
                feedback TEXT NULL,
                graded_by INT NULL,
                graded_at TIMESTAMP NULL,
                UNIQUE KEY unique_submission (assignment_id, student_id),
                FOREIGN KEY (assignment_id) REFERENCES week_assignments(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (graded_by) REFERENCES users(id) ON DELETE SET NULL
            )`,
            `CREATE TABLE IF NOT EXISTS week_quizzes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                course_id INT NOT NULL,
                staff_id INT NOT NULL,
                week_number INT NOT NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                quiz_password VARCHAR(100) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_week_quiz (course_id, week_number),
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
                FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS week_quiz_questions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                quiz_id INT NOT NULL,
                question_text TEXT NOT NULL,
                option_a VARCHAR(300) NOT NULL,
                option_b VARCHAR(300) NOT NULL,
                option_c VARCHAR(300) NOT NULL,
                option_d VARCHAR(300) NOT NULL,
                correct_answer ENUM('a','b','c','d') NOT NULL,
                FOREIGN KEY (quiz_id) REFERENCES week_quizzes(id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS week_quiz_attempts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                quiz_id INT NOT NULL,
                student_id INT NOT NULL,
                score INT NOT NULL,
                total_questions INT NOT NULL,
                answers JSON,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_attempt (quiz_id, student_id),
                FOREIGN KEY (quiz_id) REFERENCES week_quizzes(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
            )`
        ];
        for (const sql of tables) {
            await conn.query(sql);
        }

        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        console.log('Week-course tables initialized.');
    } catch (err) {
        console.error('Database init error:', err.message);
    } finally {
        conn.release();
    }
}

// Start Server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // Initialize tables in the background after server is listening
    initDatabase().catch(err => {
        console.error('Database init error:', err.message);
    });
});


