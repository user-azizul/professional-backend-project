import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Test Route
app.get("/test", (req, res) => {
  res.send("Test route is working!");
});

// User Routes
import userRouter from "./routes/user.routes.js";
app.use("/api/v1/users", userRouter);

app.use((err, req, res, next) => {
  console.error(err.stack);
  if (process.env.NODE_ENV === "development") {
    return res.status(500).json({ message: err.message, stack: err.stack });
  }
  res.status(500).json({ message: "Something went wrong!" });
});
export { app };
