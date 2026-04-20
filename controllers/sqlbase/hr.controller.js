const {User, Role, Branch,HiringRequest,JobPost,CandidateApplication, Payroll} = require("../../model/SQL_Model");

const axios = require("axios");

exports.createEmployee = async (req, res) => {
  try {
    const { name, email, phone, salary, designation } = req.body;

    const exists = await User.findOne({ where: { email } });
    if (exists) {
      return res.status(400).json({ error: "Email already exists" });
    }

    const employeeRole = await Role.findOne({
      where: { name: "employee" }
    });

    const employee = await User.create({
      name,
      email,
      phone,
      salary,
      designation,
      password: "123456", 
      role_id: employeeRole?.id,
      branch_id: req.user.branch_id
    });

    try {
      await axios.post(
        "http://localhost:5000/api/hr/sync-employee",
        {
          empId: employee.id, 
          name: employee.name,
          email: employee.email,
          phone: employee.phone,
          role: "employee",
          companyCode: req.user.branch_id
        },
        {
          headers: {
            "x-api-key": "ims-secret"
          }
        }
      );
    } catch (syncError) {
      console.error("Attendance sync failed:", syncError.message);
    }

    res.status(201).json({
      message: "Employee created & synced",
      employee
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getEmployees = async (req, res) => {
  try {
    const employees = await User.findAll({
      where: { branch_id: req.user.branch_id },
      attributes: { exclude: ["password"] },
      include: {
        association: "role",
        attributes: ["name"]
      }
    });

    res.json({
      total: employees.length,
      employees
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



exports.updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    const employee = await User.findOne({
      where: {
        id,
        branch_id: req.user.branch_id
      }
    });

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    await employee.update({
      name: req.body.name,
      phone: req.body.phone,
      salary: req.body.salary,
      designation: req.body.designation
    });

    res.json({
      message: "Employee updated",
      employee
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



exports.createHiringRequest = async (req, res) => {
  try {
    const request = await HiringRequest.create({
      ...req.body,
      requested_by: req.user.id,
      branch_id: req.user.branch_id
    });

    res.json(request);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



exports.generateJobLink = async (req, res) => {
  try {

    const slug = `job-${Date.now()}`;

    const job = await JobPost.create({
      hiring_request_id: req.params.id,
      slug
    });

    res.json({
      applyLink: `${process.env.FRONTEND_URL}/apply/${slug}`
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.applyJob = async (req, res) => {
  try {

    const job = await JobPost.findOne({
      where: { slug: req.params.slug }
    });

    if (!job) {
      return res.status(404).json({ error: "Invalid job link" });
    }

    await CandidateApplication.create({
      ...req.body,
      job_post_id: job.id
    });

    res.json({
      message: "Applied successfully"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.createPayroll = async (req, res) => {
  try {

    const {
      employee_id,
      month,
      days_present,
      leave_days = 0,
      absent_days = 0,
      advance = 0,
      pf = 0,
      tds = 0,
      food_allowance = 0,
      travel_allowance = 0,
      bonus = 0,
      remarks
    } = req.body;

    const employee = await User.findOne({
      where: {
        id: employee_id,
        branch_id: req.user.branch_id
      }
    });

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const basicSalary = employee.salary || 0;
    const perDay = basicSalary / 30;

    const gross =
      (perDay * days_present) +
      food_allowance +
      travel_allowance +
      bonus;

    const deductions = pf + tds + advance;

    const netPayable = gross - deductions;

    const payroll = await Payroll.create({
      employee_id,
      branch_id: req.user.branch_id,
      month,

      company_name: "Your Company",
      designation: employee.designation,

      ctc: basicSalary,
      per_day_salary: perDay,

      days_present,
      leave_days,
      absent_days,

      advance,
      pf,
      tds,
      food_allowance,
      travel_allowance,
      bonus,

      net_payable: netPayable,
      remarks
    });

    res.json({
      message: "Payroll generated",
      payroll
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



exports.getPayrollSheet = async (req, res) => {
  try {

    const { month } = req.query;

    const payrolls = await Payroll.findAll({
      where: {
        branch_id: req.user.branch_id,
        month
      },
      include: [
        {
          model: User,
          as: "employee",
          attributes: ["id", "name", "email"]
        }
      ],
      order: [["created_at", "DESC"]]
    });

    res.json({
      total: payrolls.length,
      payrolls
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.markPayrollPaid = async (req, res) => {
  try {

    const payroll = await Payroll.findByPk(req.params.id);

    if (!payroll)
      return res.status(404).json({ error: "Payroll not found" });

    await payroll.update({ status: "PAID" });

    res.json({ message: "Salary marked as paid" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getEmployeePayroll = async (req, res) => {
  try {

    const { employeeId } = req.params;
    const { month } = req.query;

    const whereCondition = {
      employee_id: employeeId
    };

    if (month) {
      whereCondition.month = month;
    }

    const payrolls = await Payroll.findAll({
      where: whereCondition,
      include: [
        {
          model: User,
          as: "employee",
          attributes: ["id", "name", "designation", "salary"]
        }
      ],
      order: [["created_at", "DESC"]]
    });

    if (!payrolls.length) {
      return res.status(404).json({ error: "No payroll found" });
    }

    res.json({
      total: payrolls.length,
      payrolls
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
