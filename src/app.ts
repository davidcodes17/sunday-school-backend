import express, { Request, Response } from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { Parser as Json2CsvParser } from "json2csv";
import PDFDocument from "pdfkit";

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Backend is live 🚀" });
});

// Register
app.post("/register", async (req: Request, res: Response) => {
  try {
    const { name, email, phone, department, pin } = req.body;

    if (!name || !email || !phone || !department || !pin) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const hashedPin = await bcrypt.hash(pin, 10);

    const user = await prisma.user.create({
      data: { name, email, phone, department, pin: hashedPin },
    });

    res.json({
      message: "User registered successfully",
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Login & Mark Attendance
app.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, pin } = req.body;
    if (!email || !pin)
      return res.status(400).json({ error: "Email and PIN required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const validPin = await bcrypt.compare(pin, user.pin);
    if (!validPin) return res.status(401).json({ error: "Invalid PIN" });

    // Mark attendance (only once per day)
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));

    const existingAttendance = await prisma.attendance.findFirst({
      where: { userId: user.id, date: { gte: startOfDay } },
    });

    if (existingAttendance) {
      return res.json({ message: "Attendance already marked today ✅" });
    }

    await prisma.attendance.create({
      data: { userId: user.id },
    });

    res.json({ message: "Attendance marked successfully ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Get all users (for admin)
// app.get("/users", async (_req, res) => {
//   const users = await prisma.user.findMany({ include: { attendances: true } });
//   res.json(users);
// });

interface Attendance {
  id: number;
  user: {
    name: string;
    email: string;
    phone: string;
    department: string;
  };
  date: Date;
}

app.get("/export-attendance", async (req: Request, res: Response) => {
  try {
    const { format } = req.query; // ?format=csv or ?format=pdf
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));

    // Fetch today’s attendance with user info
    const attendances = await prisma.attendance.findMany({
      where: { date: { gte: startOfDay } },
      include: { user: true },
    });

    if (!attendances.length) {
      return res.status(404).json({ error: "No attendance found for today" });
    }

    // Transform data
    const data = attendances.map((a: Attendance, index) => ({
      sn: index + 1, // 👈 auto-increment per row
      name: a.user.name,
      email: a.user.email,
      phone: a.user.phone + "",
      department: a.user.department,
      date: a.date.toISOString().split("T")[0],
      time: new Date(a.date).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true, // 👈 adds AM/PM
      }),
    }));

    // CSV Export
    if (format === "csv") {
      const parser = new Json2CsvParser({ fields: Object.keys(data[0]) });
      const csv = parser.parse(data);
      res.header("Content-Type", "text/csv");
      res.attachment(`attendance-${today.toISOString().split("T")[0]}.csv`);
      return res.send(csv);
    }

    // PDF Export
    if (format === "pdf") {
      res.header("Content-Type", "application/pdf");
      res.attachment(`attendance-${today.toISOString().split("T")[0]}.pdf`);

      const doc = new PDFDocument();
      doc.pipe(res);

      doc.fontSize(18).text("Daily Attendance Report", { align: "center" });
      doc.moveDown();

      data.forEach((item, i) => {
        doc
          .fontSize(12)
          .text(
            `${i + 1}. ${item.name} | ${item.email} | ${item.phone} | ${
              item.department
            } | ${item.date} ${item.time}`
          );
      });

      doc.end();
      return;
    }

    // Default fallback
    return res
      .status(400)
      .json({ error: "Invalid format. Use ?format=csv or ?format=pdf" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// const PORT = 4000;
// app.listen(PORT, () => {
//   console.log(`🚀 Server running on http://localhost:${PORT}`);
// });

export default app;
