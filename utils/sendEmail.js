// require('dotenv').config();
// const nodemailer = require('nodemailer');

// const transporter = nodemailer.createTransport({
//   host: "smtp-relay.brevo.com",
//   port: 587,
//   secure: false,
//   auth: {
//     user: process.env.BREVO_USER, // apna brevo email ya id
//     pass: process.env.BREVO_PASS, // API key from Brevo
//   },
// });


//     // Check connection before sending
//     await transporter.verify();
//     console.log("SMTP connection successful ✅");

//     const info = await transporter.sendMail({
//       from: `"Test" <${process.env.EMAIL_USER}>`,
//       to: process.env.EMAIL_USER,
//       subject: 'Test email from Nodemailer',
//       text: 'Hello! This is a test email.',
//     });

//     console.log("Message sent:", info.messageId);

//   } catch (error) {
//     console.error('Error sending email:', error);
//   }
// })();
