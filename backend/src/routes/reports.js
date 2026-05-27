const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/reports/doctor-stats
// Highly inefficient nested loop aggregate reporting for admin/receptionists dashboard
// PERFORMANCE BUG: Performs multiple nested DB queries inside a loop for every doctor.
// Runs sequentially, blocking/scaling terrible with doctors count.
router.get("/doctor-stats", authenticate, async (req, res) => {
  try {
    const start = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [doctors, appointmentStats, todayTokenCounts] = await Promise.all([
      prisma.doctor.findMany(),
      prisma.appointment.groupBy({
        by: ["doctorId", "status"],
        _count: { id: true },
      }),
      prisma.queueToken.groupBy({
        by: ["doctorId"],
        where: { createdAt: { gte: today } },
        _count: { id: true },
      }),
    ]);

    const appointmentMap = {};
    for (const row of appointmentStats) {
      if (!appointmentMap[row.doctorId]) {
        appointmentMap[row.doctorId] = { total: 0, completed: 0, cancelled: 0 };
      }
      appointmentMap[row.doctorId].total += row._count.id;
      if (row.status === "COMPLETED")
        appointmentMap[row.doctorId].completed = row._count.id;
      if (row.status === "CANCELLED")
        appointmentMap[row.doctorId].cancelled = row._count.id;
    }
    const tokenMap = {};
    for (const row of todayTokenCounts) {
      tokenMap[row.doctorId] = row._count.id;
    }

    const reportData = doctors.map((doc) => {
      const stats = appointmentMap[doc.id] || {
        total: 0,
        completed: 0,
        cancelled: 0,
      };
      return {
        id: doc.id,
        name: doc.name,
        specialization: doc.specialization,
        department: doc.department,
        totalAppointments: stats.total,
        completedAppointments: stats.completed,
        cancelledAppointments: stats.cancelled,
        todayQueueSize: tokenMap[doc.id] || 0,
        revenue: stats.completed * doc.consultationFee,
      };
    });

    const durationMs = Date.now() - start;
    res.json({ success: true, timeTakenMs: durationMs, data: reportData });
  } catch (error) {
    res.status(500).json({ error: "Failed to generate report" });
  }
});

module.exports = router;
