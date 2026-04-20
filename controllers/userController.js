const User = require('../model/user');

// ✅ Get Profile
exports.getProfile = async (req, res) => {
  try {
    res.status(200).json({
      message: 'Profile fetched successfully',
      user: req.user
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch profile', error: err.message });
  }
};

// ✅ Get All Users — only for Super Admin
exports.getAllUsers = async (req, res) => {
  try {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Only Super Admin can view all users' });
    }

    const users = await User.find().select('-password');
    res.status(200).json({ users });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
};

// ✅ Create Admin (only Super Admin can create admin)
exports.createAdmin = async (req, res) => {
  try {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Only Super Admin can create admins' });
    }

    const { name, email, contactNumber, address, image, CINnumber, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newAdmin = new User({
      name,
      email,
      contactNumber,
      address,
      image,
      CINnumber,
      password: hashedPassword,
      role: 'admin',
      isVerified: true
    });

    await newAdmin.save();

    res.status(201).json({ message: 'Admin created successfully', admin: newAdmin });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create admin', error: err.message });
  }
};

// ✅ Update User (allowed: superadmin can edit anyone, admin can edit users)
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const loggedInUser = req.user;

    // 🧠 Role control
    if (loggedInUser.role === 'admin' && loggedInUser._id.toString() !== id) {
      return res.status(403).json({ message: 'Admin can only update their own details' });
    }

    if (loggedInUser.role === 'user' && loggedInUser._id.toString() !== id) {
      return res.status(403).json({ message: 'User can only update their own profile' });
    }

    const { password, role, ...updateData } = req.body; // prevent password/role changes here

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) return res.status(404).json({ message: 'User not found' });

    res.status(200).json({ message: 'User updated successfully', user: updatedUser });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update user', error: err.message });
  }
};

// ✅ Delete User (only Super Admin can delete)
exports.deleteUser = async (req, res) => {
  try {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Only Super Admin can delete users' });
    }

    const { id } = req.params;
    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) return res.status(404).json({ message: 'User not found' });

    res.status(200).json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete user', error: err.message });
  }
};
