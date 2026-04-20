const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

const {
  getProfile,
  getAllUsers,
  updateUser,
  deleteUser
} = require('../controllers/userController');

// ✅ Get logged-in user profile
router.get('/profile', auth, getProfile);

// ✅ Admin-only: Get all users
router.get('/all user', auth, getAllUsers);

// ✅ Admin-only: Update a user by ID (excluding name, email, password)
router.put('/:id', auth, updateUser);

// ✅ Admin-only: Delete a user by ID
router.delete('/:id', auth, deleteUser);

module.exports = router;
