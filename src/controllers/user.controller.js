import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { User } from "../models/user.models.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";

const generateAccessAndRefreshToken = async (userId) => {
  try {
    const user = User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();
    user.refreshToken = refreshToken;
    await user.save({
      validateBeforeSave: false,
    });
    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      "something went wrong while generating refresh token and access token"
    );
  }
};

const registerUser = asyncHandler(async (req, res) => {
  const { fullname, email, username, password } = req.body;

  if (
    [fullname, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All fields are required");
  }

  const existingUser = await User.findOne({ $or: [{ username }, { email }] });
  console.log("Existing User:", existingUser);

  if (existingUser) {
    throw new ApiError(409, "User already exists");
  }
  console.log("Incoming Request Body:", req.body); // Log request body
  console.log("Uploaded Files:", req.files); // Log uploaded files
  const avatarLocalPath = req.files?.avatar?.[0]?.path;
  const coverImageLocalPath = req.files?.coverImage?.[0]?.path;
  console.log("Avatar Path:", avatarLocalPath);
  console.log("Cover Image Path:", coverImageLocalPath);

  const avatar = await uploadOnCloudinary(avatarLocalPath);
  console.log("Avatar Cloudinary URL:", avatar?.url);

  const coverImage = coverImageLocalPath
    ? await uploadOnCloudinary(coverImageLocalPath)
    : null;
  console.log("Cover Image Cloudinary URL:", coverImage?.url);

  const user = await User.create({
    fullname,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    password,
    email,
    username: username.toLowerCase(),
  });
  console.log("New User Created:", user);

  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );
  if (!createdUser) {
    throw new ApiError(500, "Something went wrong when creating user");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, createdUser, "User registered successfully"));
});
const loginUser = asyncHandler(async (req, res) => {
  // get data from req.body
  const { email, username, password } = req.body;
  // username or email
  if (!username || !email) {
    throw new ApiError(400, "username or email is required");
  }
  // find the user is user available
  // User.findOne({username})
  // User.findOne({email})
  const user = await User.findOne({
    $or: [{ username }, { email }],
  });
  if (!user) throw new ApiError(404, "user not found");
  // password check
  const isPasswordValid = await user.isPasswordCorrect(password);
  if (!isPasswordValid) throw new ApiError(404, "password is not correct");
  // access and refresh token generate
  const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
    user._id
  );
  const loggedInUser = await User.findOne(user._id).select(
    "-password -refreshToken"
  );
  //send token cookie
  const options = {
    //by default cokies can be edited by anyone through front end if i use httpOnly it can be edited by database only
    httpOnly: true,
    secure: true,
  };

  // send response login successfully
  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken,
        },
        "User loged in"
      )
    );
});
const logoutUser = asyncHandler(async (req, res) => {
  //find user
  await User.findByIdAndUpdate(req.user._id, {
    $set: {
      refreshToken: undefined,
    },
    new: true,
  });
  const options = {
    httpOnly: true,
    secure: true,
  };
  return res
    .status(200)
    .clearCookies("refreshToken", options)
    .clearCookies("accessToken", options)
    .json(new ApiResponse(200, {}, "User Logged out"));

  //
});
export { registerUser, loginUser, logoutUser };
