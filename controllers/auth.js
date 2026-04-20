const User = require('../model/user');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
};

// ✅ REGISTER
exports.register = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      address,
      image,
      CINnumber,
      branch,
      location,
      password,
      confirmPassword,
      role = 'user'
    } = req.body;

    if (!name || !email || !phone || !address || !password || !confirmPassword || !branch || !location) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Password and Confirm Password do not match' });
    }

    const existingUser = await User.findOne({ email: email.trim().toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email: email.trim().toLowerCase(),
      phone,
      address,
      image,
      CINnumber,
      branch,
      location,
      password: hashedPassword,
      role,
      isVerified: true
    });

    return res.status(201).json({
      message: 'Registration successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        image: user.image,
        CINnumber: user.CINnumber,
        branch: user.branch,
        location: user.location,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Register Error:', err);
    return res.status(500).json({ message: 'Registration failed', error: err.message });
  }
};

// ✅ LOGIN
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) return res.status(400).json({ message: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = generateToken(user);

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        image: user.image,
        CINnumber: user.CINnumber,
        branch: user.branch,
        location: user.location,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login Error:', err);
    return res.status(500).json({ message: 'Login failed', error: err.message });
  }
};

// app.post("/api/attendance-from-portal", async (req, res) => {
//   try {
//     const { empId, date, inTime, outTime } = req.body;

//     await pool.query(
//       `INSERT INTO attendance_logs (emp_id, date, in_time, out_time)
//        VALUES ($1, $2, $3, $4)`,
//       [empId, date, inTime, outTime]
//     );

//     res.json({ message: "Saved in IMS" });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "IMS error" });
//   }
// });