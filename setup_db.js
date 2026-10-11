const mysql = require('mysql2/promise');

async function setupDB() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            user: 'lms_user',
            password: process.env.DB_PASSWORD || 'lms_pass_change_me'
        });

        console.log("Connected to MariaDB. Creating database and tables...");

        await connection.query('CREATE DATABASE IF NOT EXISTS lms_system');
        await connection.query('USE lms_system');

        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role ENUM('admin', 'staff', 'student') NOT NULL,
                is_approved BOOLEAN DEFAULT 0
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS classes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) UNIQUE NOT NULL,
                staff_id INT NULL,
                mentor_id INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (mentor_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Ensure mentor_id column exists even if classes table was created before this feature
        try { await connection.query('ALTER TABLE classes ADD COLUMN mentor_id INT NULL'); } catch(e) {}
        try { await connection.query('ALTER TABLE classes ADD CONSTRAINT fk_classes_mentor FOREIGN KEY (mentor_id) REFERENCES users(id) ON DELETE SET NULL'); } catch(e) {}

        await connection.query(`
            CREATE TABLE IF NOT EXISTS staff_details (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL UNIQUE,
                full_name VARCHAR(100),
                staff_id VARCHAR(50),
                age INT,
                aadhaar VARCHAR(20),
                phone VARCHAR(20),
                email VARCHAR(100),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Ensure staff_details has email/phone columns for older DBs
        try { await connection.query('ALTER TABLE staff_details ADD COLUMN email VARCHAR(100) NULL'); } catch(e) {}
        try { await connection.query('ALTER TABLE staff_details ADD COLUMN phone VARCHAR(20) NULL'); } catch(e) {}

        // Ensure leave_applications table exists
        await connection.query(`
            CREATE TABLE IF NOT EXISTS leave_applications (
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
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS student_details (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                full_name VARCHAR(100),
                class_id INT,
                phone VARCHAR(20),
                address TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS materials (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(100) NOT NULL,
                file_url VARCHAR(255) NOT NULL,
                class_id INT,
                uploaded_by INT,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
                FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS forms (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(100) NOT NULL,
                link VARCHAR(255) NOT NULL,
                staff_id INT,
                class_id INT DEFAULT NULL,
                FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL
            )
        `);
        // Ensure class_id column exists (MariaDB doesn't support ADD COLUMN IF NOT EXISTS)
        try {
            await connection.query('ALTER TABLE forms ADD COLUMN class_id INT DEFAULT NULL');
        } catch (e) {
            // Column likely already exists - ignore error
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sender_id INT NOT NULL,
                receiver_id INT NOT NULL,
                message_text TEXT,
                media_url VARCHAR(255) DEFAULT NULL,
                media_type ENUM('image','video','file','text','audio') DEFAULT 'text',
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Update columns for existing tables
        try {
            await connection.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE');
            await connection.query("ALTER TABLE messages MODIFY COLUMN media_type ENUM('image','video','file','text','audio') DEFAULT 'text'");
        } catch (e) {
            // Ignore alter errors
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS attendance (
                id INT AUTO_INCREMENT PRIMARY KEY,
                student_id INT NOT NULL,
                class_id INT NOT NULL,
                date DATE NOT NULL,
                status ENUM('Present', 'Absent') NOT NULL,
                marked_by INT,
                UNIQUE KEY unique_attendance (student_id, date),
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
                FOREIGN KEY (marked_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Assignment Tables
        await connection.query(`
            CREATE TABLE IF NOT EXISTS assignments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                class_id INT NOT NULL,
                staff_id INT NOT NULL,
                max_marks DECIMAL(5,2) DEFAULT 100,
                due_date DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
                FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Add max_marks column if it doesn't exist (for existing installations)
        try {
            await connection.query('ALTER TABLE assignments ADD COLUMN IF NOT EXISTS max_marks DECIMAL(5,2) DEFAULT 100');
            await connection.query('ALTER TABLE assignments ADD COLUMN IF NOT EXISTS due_date DATETIME NULL');
        } catch (e) {
            // Column may already exist - ignore error
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS assignment_submissions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                assignment_id INT NOT NULL,
                student_id INT NOT NULL,
                file_url VARCHAR(255) NOT NULL,
                marks DECIMAL(5,2) DEFAULT NULL,
                feedback TEXT,
                graded_by INT DEFAULT NULL,
                graded_at TIMESTAMP NULL DEFAULT NULL,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_submission (assignment_id, student_id),
                FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (graded_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Add marks/feedback columns if they don't exist (for existing installations)
        try {
            await connection.query('ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS marks DECIMAL(5,2) DEFAULT NULL');
            await connection.query('ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS feedback TEXT');
            await connection.query('ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS graded_by INT DEFAULT NULL');
            await connection.query('ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS graded_at TIMESTAMP NULL DEFAULT NULL');
        } catch (e) {
            // Some columns may already exist - ignore errors
        }

        // Quiz Tables
        await connection.query(`
            CREATE TABLE IF NOT EXISTS quizzes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                class_id INT NOT NULL,
                staff_id INT NOT NULL,
                quiz_password VARCHAR(100) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
                FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        // Ensure quiz_password column exists on older databases
        try {
            await connection.query('ALTER TABLE quizzes ADD COLUMN quiz_password VARCHAR(100) NULL');
        } catch (e) {
            // Column likely already exists - ignore error
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS quiz_questions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                quiz_id INT NOT NULL,
                question_text TEXT NOT NULL,
                option_a VARCHAR(255) NOT NULL,
                option_b VARCHAR(255) NOT NULL,
                option_c VARCHAR(255) NOT NULL,
                option_d VARCHAR(255) NOT NULL,
                correct_answer ENUM('a','b','c','d') NOT NULL,
                FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS quiz_attempts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                quiz_id INT NOT NULL,
                student_id INT NOT NULL,
                score INT NOT NULL DEFAULT 0,
                total_questions INT NOT NULL DEFAULT 0,
                answers JSON,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_attempt (quiz_id, student_id),
                                FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Week Course Tables
        // A Course spans a number of weeks. If class_id is NULL the course is
        // visible to ALL classes; otherwise it is visible only to that class.
        await connection.query(`
            CREATE TABLE IF NOT EXISTS courses (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                total_weeks INT NOT NULL DEFAULT 1,
                class_id INT NULL,
                staff_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
                FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Assignments created inside a specific week of a course.
        // file_type restricts what students may upload (pdf / csv / mp4 / any)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS week_assignments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                course_id INT NOT NULL,
                staff_id INT NOT NULL,
                week_number INT NOT NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                due_date DATETIME NULL,
                file_type ENUM('pdf','csv','mp4','any') DEFAULT 'any',
                max_marks DECIMAL(5,2) DEFAULT 100,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
                FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_course_week (course_id, week_number)
            )
        `);

        // Student submissions for week assignments (one per student per assignment)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS week_assignment_submissions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                assignment_id INT NOT NULL,
                student_id INT NOT NULL,
                file_url VARCHAR(255) NOT NULL,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                marks DECIMAL(5,2) DEFAULT NULL,
                feedback TEXT,
                graded_by INT DEFAULT NULL,
                graded_at TIMESTAMP NULL DEFAULT NULL,
                UNIQUE KEY unique_submission (assignment_id, student_id),
                FOREIGN KEY (assignment_id) REFERENCES week_assignments(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (graded_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Weekly quizzes (password-gated). quiz_password NULL means no password gate yet.
        await connection.query(`
            CREATE TABLE IF NOT EXISTS week_quizzes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                course_id INT NOT NULL,
                staff_id INT NOT NULL,
                week_number INT NOT NULL,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                quiz_password VARCHAR(100) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
                FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_course_week_quiz (course_id, week_number)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS week_quiz_questions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                quiz_id INT NOT NULL,
                question_text TEXT NOT NULL,
                option_a VARCHAR(255) NOT NULL,
                option_b VARCHAR(255) NOT NULL,
                option_c VARCHAR(255) NOT NULL,
                option_d VARCHAR(255) NOT NULL,
                correct_answer ENUM('a','b','c','d') NOT NULL,
                FOREIGN KEY (quiz_id) REFERENCES week_quizzes(id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS week_quiz_attempts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                quiz_id INT NOT NULL,
                student_id INT NOT NULL,
                score INT NOT NULL DEFAULT 0,
                total_questions INT NOT NULL DEFAULT 0,
                answers JSON,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_attempt (quiz_id, student_id),
                FOREIGN KEY (quiz_id) REFERENCES week_quizzes(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Create default admin account if not exists
        const bcrypt = require('bcrypt');
        const [rows] = await connection.query('SELECT * FROM users WHERE role = ?', ['admin']);
        if (rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await connection.query(
                'INSERT INTO users (username, password, role, is_approved) VALUES (?, ?, ?, ?)',
                ['admin', hashedPassword, 'admin', 1]
            );
            console.log("Default admin created: admin / admin123");
        }

        console.log("Database setup complete!");
        process.exit(0);
    } catch (err) {
        console.error("Error setting up database:", err);
        process.exit(1);
    }
}

setupDB();
