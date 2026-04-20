const authService = require("./auth.controller");

exports.register = async (req, res) => {
 try {
    const user = await authCtrl.register(req.body);
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const data = await authCtrl.login(req.body);
    res.json(data);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
};
