import connectDB from "./db/index.js";
import dotenv from "dotenv";
import { app } from "./app.js";

dotenv.config({
  path: "./.env",
});
const port = process.env.PORT || 8001
connectDB()
  .then(() => {
    app.listen(port , () => {
      console.log(`Server in running at port : ${port}`);
    });
  })
  .catch((err) => console.error(err, "MongoDB connection faild!!!"));
/*
import express form "express"
const app = express();
(async () => {
  try {
   await mongoose.connect(`${process.env.MONGODB_URI}/ ${DB_NAME}`);
   app.on('error', (err) => {
    console.log(err,'error');
    throw err;
    
   })
   app.listen(process.env.PORT,() => {
    console.log(`App is running on port ${process.env.PORT}`);
    
   })
  } catch (error) {
    console.error(error,'Error');
    throw error
  }  
})() */
