import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";
const videoSchema = new Schema(
  {
    videoFile: {
      type: String, // cloudinary url
      required: true,
    },
    thumbnail: {
      type: String, // cloudinary url
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    discription: {
      type: String,
      required: true,
    },
    duration: {
      type: String, // cloudinary url
      required: true,
    },
    viwes: {
      type: Number,
      default: 0,
    },
    isPublished: {
      type: bolean,
      default: true,
    },
    videoOwner: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timeStamp: true }
);

videoSchema.plugin(mongooseAggregatePaginate);

export const Video = mongoose.model("Video", videoSchema);
