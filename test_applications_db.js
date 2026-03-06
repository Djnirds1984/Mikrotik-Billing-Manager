// Test script to check applications in database
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'proxy', 'panel.db');
const db = new sqlite3.Database(dbPath);

console.log('Checking applications in database...');

db.all('SELECT * FROM applications ORDER BY createdAt DESC LIMIT 5', (err, rows) => {
  if (err) {
    console.error('Error querying applications:', err);
    return;
  }
  
  console.log('Recent applications:');
  rows.forEach((row, index) => {
    console.log(`${index + 1}. ID: ${row.id}`);
    console.log(`   Name: ${row.name}`);
    console.log(`   Email: ${row.email}`);
    console.log(`   Phone: ${row.phone}`);
    console.log(`   Plan: ${row.planName}`);
    console.log(`   PDF: ${row.pdfPath}`);
    console.log(`   Created: ${row.createdAt}`);
    console.log('');
  });
  
  db.close();
});