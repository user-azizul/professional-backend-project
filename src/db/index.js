import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";

const connectDB = async () => {
  try {
    const res = await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`);
    console.log(`\n MongoDB connected  !! DB HOST :${res.connection.host}`);
  } catch (error) {
    console.log(error, "DB connection error");
    process.exit(1);
  }
};

export default connectDB;
