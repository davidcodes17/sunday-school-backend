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

// Health Check
app.get("/", (_req, res) => {
  res.json({ message: "Welcome! The backend is running smoothly 🚀" });
});

// Register
app.post("/register", async (req: Request, res: Response) => {
  try {
    const { name, email, phone, department, pin } = req.body;

    if (!name || !email || !phone || !department || !pin) {
      return res
        .status(400)
        .json({ error: "Please fill in all required fields to continue." });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res
        .status(400)
        .json({ error: "This email is already registered. Try logging in." });
    }

    const hashedPin = await bcrypt.hash(pin, 10);

    const user = await prisma.user.create({
      data: { name, email, phone, department, pin: hashedPin },
    });

    res.json({
      message: `Welcome aboard, ${name}! Your account has been created successfully.`,
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "Oops! Something went wrong on our side. Please try again later." });
  }
});

// Login & Mark Attendance
app.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, pin } = req.body;

    if (!email || !pin) {
      return res
        .status(400)
        .json({ error: "Both email and PIN are required to log in." });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res
        .status(404)
        .json({ error: "We couldn't find an account with that email." });
    }

    const validPin = await bcrypt.compare(pin, user.pin);
    if (!validPin) {
      return res.status(401).json({ error: "Incorrect PIN. Please try again." });
    }

    // Mark attendance (only once per day)
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));

    const existingAttendance = await prisma.attendance.findFirst({
      where: { userId: user.id, date: { gte: startOfDay } },
    });

    if (existingAttendance) {
      return res.json({ message: "You've already marked your attendance today. ✅" });
    }

    await prisma.attendance.create({ data: { userId: user.id } });

    res.json({ message: "Attendance successfully marked. Have a great day! ✅" });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "Something went wrong while marking your attendance. Please try again." });
  }
});

// Export Attendance
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

    const attendances = await prisma.attendance.findMany({
      where: { date: { gte: startOfDay } },
      include: { user: true },
    });

    if (!attendances.length) {
      return res
        .status(404)
        .json({ error: "No attendance has been recorded for today yet." });
    }

    const data = attendances.map((a: Attendance, index) => ({
      sn: index + 1,
      name: a.user.name,
      email: a.user.email,
      phone: a.user.phone + "",
      department: a.user.department,
      date: a.date.toISOString().split("T")[0],
      time: new Date(a.date).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }),
    }));

    if (format === "csv") {
      const parser = new Json2CsvParser({ fields: Object.keys(data[0]) });
      const csv = parser.parse(data);
      res.header("Content-Type", "text/csv");
      res.attachment(`attendance-${today.toISOString().split("T")[0]}.csv`);
      return res.send(csv);
    }

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
            `${i + 1}. ${item.name} | ${item.email} | ${item.phone} | ${item.department} | ${item.date} ${item.time}`
          );
      });

      doc.end();
      return;
    }

    return res.status(400).json({
      error: "Invalid export format. Please use ?format=csv or ?format=pdf",
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "We encountered an error while exporting attendance. Please try again." });
  }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
