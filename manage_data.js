const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const dbConfig = {
    host: 'localhost',
    user: 'lms_user',
    password: 'lms_pass_change_me',
    database: 'lms_system'
};

async function clearAllData() {
    const connection = await mysql.createConnection(dbConfig);
    try {
        console.log("Clearing existing data...");
        await connection.beginTransaction();

        // Disable foreign key checks temporarily
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');

        // Delete from tables that depend on others first
        await connection.query('DELETE FROM student_details');
        console.log("Deleted all student details.");
        await connection.query('DELETE FROM staff_details');
        console.log("Deleted all staff details.");
        await connection.query('DELETE FROM classes');
        console.log("Deleted all classes.");
        // Delete users with roles 'student' and 'staff'
        await connection.query("DELETE FROM users WHERE role IN ('student', 'staff')");
        console.log("Deleted all student and staff user accounts.");
        
        // Re-enable foreign key checks
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');

        await connection.commit();
        console.log("All specified data cleared successfully.");
    } catch (error) {
        await connection.rollback();
        console.error("Error clearing data:", error);
    } finally {
        connection.end();
    }
}

async function createClassAndStudents(year, section, startDno, numStudents, names, password) {
    const connection = await mysql.createConnection(dbConfig);
    try {
        await connection.beginTransaction();

        const className = `${year} Year ${section} section`;
        console.log(`Creating class: ${className}`);

        // Insert class
        const [classResult] = await connection.query(
            'INSERT INTO classes (name) VALUES (?)',
            [className]
        );
        const classId = classResult.insertId;
        console.log(`Class '${className}' created with ID: ${classId}`);

        // Generate and insert student data
        const hashedPassword = await bcrypt.hash(password, 10);

        for (let i = 0; i < numStudents; i++) {
            const studentName = names[i % names.length]; // Cycle through names
            const currentYearPrefix = 27 - year;
            const dno = `${currentYearPrefix}UCS${String(startDno + i).padStart(3, '0')}`;            const username = dno;            
            // Insert user
            const [userResult] = await connection.query(
                'INSERT INTO users (username, password, role, is_approved) VALUES (?, ?, ?, ?)',
                [username, hashedPassword, 'student', 1]
            );
            const userId = userResult.insertId;

            // Insert student details
            await connection.query(
                'INSERT INTO student_details (user_id, full_name, class_id, phone, address) VALUES (?, ?, ?, ?, ?)',
                [userId, studentName, classId, `98765432${String(i).padStart(2, '0')}`, `Address for ${studentName}`]
            );
            console.log(`  Added student: ${studentName} (${dno}) to ${className}`);
        }

        await connection.commit();
        console.log(`Successfully created ${numStudents} students for ${className}.`);
    } catch (error) {
        await connection.rollback();
        console.error(`Error creating class ${className} and students:`, error);
    } finally {
        connection.end();
    }
}

// Dummy data for Tamil Nadu boy names
const tamilNames = [
    'Aravind', 'Surya', 'Vijay', 'Karthik', 'Praveen', 'Akash', 'Saravan', 'Gokul', 'Dinesh', 'Balaji',
    'Santhosh', 'Sakthi', 'Ajay', 'Ashwin', 'Vignesh', 'Kamal', 'Sanjay', 'Mani', 'Naveen', 'Ramesh'
];

const christianNames = [
    'Joseph', 'Michael', 'Peter', 'David', 'Paul', 'Sam', 'Alvin', 'Vinoth', 'Ruben', 'Stephen',
    'Immanuel', 'Antony', 'John', 'Thomas', 'Charles', 'Edwin', 'Prince', 'Dennis', 'Trinity', 'Clement'
];

const muslimNames = [
    'Mohammed', 'Ali', 'Rahman', 'Ibrahim', 'Riyas', 'Abdul', 'Sadiq', 'Saleem', 'Farook', 'Ameer',
    'Siddique', 'Faisal', 'Jaffer', 'Irfan', 'Nawaz', 'Mustafa', 'Shaik', 'Akram', 'Azeez', 'Arshad'
];

const allBoyNames = [...tamilNames, ...christianNames, ...muslimNames];


// Main execution function
async function main() {
    await clearAllData();
    const defaultPassword = '12345678';

    // 1st Year Sections
    await createClassAndStudents(1, 'A', 501, 60, allBoyNames, defaultPassword);
    await createClassAndStudents(1, 'B', 601, 60, allBoyNames, defaultPassword);
    await createClassAndStudents(1, 'C', 701, 60, allBoyNames, defaultPassword);
    await createClassAndStudents(1, 'D', 801, 60, allBoyNames, defaultPassword);

    // 2nd Year Sections
    await createClassAndStudents(2, 'A', 501, 60, allBoyNames, defaultPassword);
    await createClassAndStudents(2, 'B', 601, 60, allBoyNames, defaultPassword);
    // Correcting the D section as per the pattern observed (701 for C, 801 for D)
    await createClassAndStudents(2, 'C', 701, 60, allBoyNames, defaultPassword); // Assuming 2nd Year C from the pattern
    await createClassAndStudents(2, 'D', 801, 60, allBoyNames, defaultPassword);

    // 3rd Year Sections
    await createClassAndStudents(3, 'A', 501, 60, allBoyNames, defaultPassword);
    await createClassAndStudents(3, 'B', 601, 60, allBoyNames, defaultPassword);
    await createClassAndStudents(3, 'C', 701, 60, allBoyNames, defaultPassword);
    await createClassAndStudents(3, 'D', 801, 60, allBoyNames, defaultPassword);

    console.log("All data generation complete!");
    process.exit(0);
}

main();