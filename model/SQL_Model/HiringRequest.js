const { DataTypes } = require("sequelize");
const sequelize = require("../config/sqlcon");

/*
=====================================
1️⃣ HIRING REQUEST (Internal)
=====================================
*/
const HiringRequest = sequelize.define("HiringRequest", {
  title: DataTypes.STRING,
  department: DataTypes.STRING,
  role_type: DataTypes.STRING, // intern / employee
  openings: DataTypes.INTEGER,
  description: DataTypes.TEXT,

  status: {
    type: DataTypes.ENUM("PENDING","APPROVED","REJECTED"),
    defaultValue: "PENDING"
  },

  branch_id: DataTypes.INTEGER,
  requested_by: DataTypes.INTEGER
},{
  tableName: "hiring_requests",
  underscored: true
});


/*
=====================================
2️⃣ JOB POST (Public Link)
=====================================
*/
const JobPost = sequelize.define("JobPost", {
  hiring_request_id: DataTypes.INTEGER,

  slug: {
    type: DataTypes.STRING,
    unique: true
  },

  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
},{
  tableName: "job_posts",
  underscored: true
});


/*
=====================================
3️⃣ CANDIDATE APPLICATION
=====================================
*/
const CandidateApplication = sequelize.define("CandidateApplication", {
  job_post_id: DataTypes.INTEGER,

  name: DataTypes.STRING,
  email: DataTypes.STRING,
  phone: DataTypes.STRING,
  resume_url: DataTypes.STRING,

  status: {
    type: DataTypes.ENUM(
      "APPLIED",
      "SHORTLISTED",
      "INTERVIEW",
      "HIRED",
      "REJECTED"
    ),
    defaultValue: "APPLIED"
  }
},{
  tableName: "candidate_applications",
  underscored: true
});


/*
=====================================
RELATIONS (VERY IMPORTANT)
=====================================
*/

HiringRequest.hasOne(JobPost, {
  foreignKey: "hiring_request_id",
  as: "jobPost"
});

JobPost.belongsTo(HiringRequest, {
  foreignKey: "hiring_request_id"
});

JobPost.hasMany(CandidateApplication, {
  foreignKey: "job_post_id",
  as: "applications"
});

CandidateApplication.belongsTo(JobPost, {
  foreignKey: "job_post_id"
});


module.exports = {
  HiringRequest,
  JobPost,
  CandidateApplication
};
