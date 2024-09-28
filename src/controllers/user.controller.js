// Import utility functions and necessary models
import { asyncHandler } from "../utils/asyncHandler.js"; // Wraps async functions to catch errors
import { ApiError } from "../utils/ApiError.js"; // Custom error handling class
import { ApiResponse } from "../utils/ApiResponse.js"; // Custom API response handler
import { User } from "../models/user.models.js"; // User model for MongoDB queries
import { uploadOnCloudinary } from "../utils/cloudinary.js"; // Function to upload files to Cloudinary
import jwt from "jsonwebtoken";
/**
 * Generate access and refresh tokens for a user.
 * @param {String} userId - The ID of the user for whom tokens are being generated.
 * @returns {Object} - Contains the accessToken and refreshToken.
 */
const generateAccessAndRefreshToken = async (userId) => {
  try {
    // Fetch the user from the database using userId
    const user = await User.findById(userId);

    // Generate access and refresh tokens for the user
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    // Save the refresh token to the user record
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    // Return both tokens
    return { accessToken, refreshToken };
  } catch (error) {
    // Throw a custom error in case token generation fails
    throw new ApiError(
      500,
      "Something went wrong while generating refresh token and access token"
    );
  }
};

/**
 * Registers a new user.
 * Handles file upload (avatar and cover image) to Cloudinary.
 * @param {Object} req - Express request object containing the new user's data and files.
 * @param {Object} res - Express response object.
 */
const registerUser = asyncHandler(async (req, res) => {
  // Destructure required fields from the request body
  const { fullname, email, username, password } = req.body;

  // Check if any field is empty
  if (
    [fullname, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All fields are required");
  }

  // Check if the user already exists by username or email
  const existingUser = await User.findOne({ $or: [{ username }, { email }] });
  if (existingUser) {
    throw new ApiError(409, "User already exists");
  }

  // File paths for avatar and cover image from uploaded files
  const avatarLocalPath = req.files?.avatar?.[0]?.path;
  const coverImageLocalPath = req.files?.coverImage?.[0]?.path;

  // Upload avatar and cover image to Cloudinary (if available)
  let avatar, coverImage;
  try {
    avatar = await uploadOnCloudinary(avatarLocalPath);
    if (coverImageLocalPath) {
      coverImage = await uploadOnCloudinary(coverImageLocalPath);
    }
  } catch (error) {
    throw new ApiError(500, "File upload failed");
  }

  // Create a new user in the database
  const user = await User.create({
    fullname,
    avatar: avatar.url, // Store avatar URL from Cloudinary
    coverImage: coverImage?.url || "", // If no cover image, store an empty string
    password,
    email,
    username: username.toLowerCase(),
  });

  // Retrieve the created user, omitting password and refreshToken fields
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  if (!createdUser) {
    throw new ApiError(500, "Something went wrong when creating user");
  }

  // Respond with success, sending back the user details
  return res
    .status(200)
    .json(new ApiResponse(200, createdUser, "User registered successfully"));
});

/**
 * Logs in a user by validating credentials.
 * Generates access and refresh tokens and sets them as cookies.
 * @param {Object} req - Express request object containing login credentials (email/username, password).
 * @param {Object} res - Express response object.
 */
const loginUser = asyncHandler(async (req, res) => {
  // Destructure required fields from the request body
  const { email, username, password } = req.body;

  // Validate that either email or username is provided
  if (!username && !email) {
    throw new ApiError(400, "username or email is required");
  }

  // Find the user by email or username
  const user = await User.findOne({
    $or: [{ username }, { email }],
  });

  // If the user is not found, return an error
  if (!user) throw new ApiError(404, "User not found");

  // Check if the password is correct
  const isPasswordValid = await user.isPasswordCorrect(password);
  if (!isPasswordValid) throw new ApiError(404, "Password is not correct");

  // Generate access and refresh tokens for the user
  const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
    user._id
  );

  // Retrieve the logged-in user without the password and refreshToken fields
  const loggedInUser = await User.findOne(user._id).select(
    "-password -refreshToken"
  );

  // Cookie options to set httpOnly and secure cookies (secure for production)
  const options = {
    httpOnly: true, // Prevents access to the cookie via JavaScript
    secure: process.env.NODE_ENV === "production", // Only send cookies over HTTPS in production
  };

  // Set cookies and respond with the logged-in user's data
  return res
    .status(200)
    .cookie("accessToken", accessToken, options) // Set access token cookie
    .cookie("refreshToken", refreshToken, options) // Set refresh token cookie
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken,
        },
        "User logged in"
      )
    );
});

/**
 * Logs out a user by clearing their refresh token and cookies.
 * @param {Object} req - Express request object containing the user's ID.
 * @param {Object} res - Express response object.
 */
const logoutUser = asyncHandler(async (req, res) => {
  // Update the user record to remove the refresh token
  await User.findByIdAndUpdate(req.user._id, {
    $set: {
      refreshToken: undefined, // Remove refresh token from the database
    },
    new: true,
  });

  // Cookie options to ensure httpOnly and secure settings
  const options = {
    httpOnly: true, // Prevents access to the cookie via JavaScript
    secure: process.env.NODE_ENV === "production", // Only send cookies over HTTPS in production
  };

  // Clear the cookies and respond with a success message
  return res
    .status(200)
    .clearCookie("refreshToken", options) // Clear refresh token cookie
    .clearCookie("accessToken", options) // Clear access token cookie
    .json(new ApiResponse(200, {}, "User logged out")); // Send response
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies.refreshToken || req.body.refreshToken;
  if (!incomingRefreshToken) {
    throw new ApiError(401, "unauthorized request");
  }

  try {
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );
    const user = await User.findById(decodedToken?._id);
    if (!user) {
      throw new ApiError(401, "invalid refresh token");
    }
    if (incomingRefreshToken !== user?.refreshToken) {
      throw new ApiError(401, "Refresh token is expired");
    }
    const options = {
      httpOnly: true,
      secure: true,
    };
    const { accessToken, newRefreshToken } =
      await generateAccessAndRefreshToken(user._id);

    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", newRefreshToken, options)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken: newRefreshToken },
          "Access token refreshed"
        )
      );
  } catch (error) {
    throw new Error(401, error?.message);
  }
});

export { registerUser, loginUser, logoutUser, refreshAccessToken };
