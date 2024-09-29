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

/**
 * Refreshes the access token using the incoming refresh token.
 * Validates the refresh token, checks its expiration, and generates new access and refresh tokens if valid.
 * @param {Object} req - Express request object containing cookies or body with the refresh token.
 * @param {Object} res - Express response object.
 */
const refreshAccessToken = asyncHandler(async (req, res) => {
  // Extract the refresh token from either cookies or request body
  const incomingRefreshToken =
    req.cookies.refreshToken || req.body.refreshToken;

  // If no refresh token is provided, throw an unauthorized error
  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized request"); // 401 Unauthorized
  }

  try {
    // Verify the refresh token using the secret key and decode the token
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    // Find the user by the ID from the decoded token
    const user = await User.findById(decodedToken?._id);

    // If no user is found, throw an error indicating the refresh token is invalid
    if (!user) {
      throw new ApiError(401, "Invalid refresh token"); // 401 Unauthorized
    }

    // Check if the incoming refresh token matches the one stored in the user document
    if (incomingRefreshToken !== user?.refreshToken) {
      throw new ApiError(401, "Refresh token is expired or does not match"); // 401 Unauthorized
    }

    // Cookie options to set httpOnly and secure cookies (secure for production)
    const options = {
      httpOnly: true, // Prevents client-side JavaScript from accessing the cookie
      secure: true, // Ensures cookies are sent over HTTPS only (important for production)
    };

    // Generate new access and refresh tokens for the user
    const { accessToken, newRefreshToken } =
      await generateAccessAndRefreshToken(user._id);

    // Send the new tokens as cookies and respond with the access token and refresh token
    return res
      .status(200)
      .cookie("accessToken", accessToken, options) // Set new access token as a cookie
      .cookie("refreshToken", newRefreshToken, options) // Set new refresh token as a cookie
      .json(
        new ApiResponse(
          200, // HTTP status code for success
          { accessToken, refreshToken: newRefreshToken }, // Data to send in response
          "Access token refreshed successfully" // Message to indicate success
        )
      );
  } catch (error) {
    // Catch any errors during token verification or user lookup and throw a 401 Unauthorized error
    throw new ApiError(401, error?.message || "Failed to refresh access token"); // 401 Unauthorized
  }
});

// Handler to change the current password of a user
const changeCurrentPassword = asyncHandler(async (req, res) => {
  // Extract oldPassword and newPassword from the request body
  const { oldPassword, newPassword } = req.body;

  // Find the user by their ID, which is stored in req.user._id
  const user = await User.findById(req.user._id);

  // Check if the old password provided is correct
  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

  // If the old password is incorrect, throw an error
  if (!isPasswordCorrect) {
    throw new ApiError(400, "Invalid old password");
  }

  // Set the new password
  user.password = newPassword;

  // Save the user object without running validation checks (e.g., re-validating password)
  await user.save({ validateBeforeSave: false });

  // Return a success response indicating the password was changed
  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(new ApiResponse(200, req.user, "Current user fetched successfully"));
});
const updatAccountDetails = asyncHandler(async (req, res) => {
  const { fullname, email } = req.body;
  if (!fullname || !email) {
    throw new ApiError(400, "All fields are required");
  }
  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $: {
        fullname,
        email,
      },
    },
    { new: ture }
  ).select(-password);

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updatated successfully"));
});

// Handler to update the user's avatar
const updateAvatar = asyncHandler(async (req, res) => {
  // Get the local path of the uploaded avatar file
  const avatarLocalPath = req.file?.path;

  // If the avatar file is not found, throw an error
  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file not found");
  }

  // Upload the avatar to Cloudinary (or other cloud service)
  const avatar = await uploadOnCloudinary(avatarLocalPath);

  // If there was an error during the upload (no URL returned), throw an error
  if (!avatar.url) {
    throw new ApiError(400, "Error while uploading avatar");
  }

  // Find the user by their ID and update the avatar URL in the database
  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        avatar: avatar.url, // Set the avatar URL to the uploaded one
      },
    },
    { new: true } // Return the updated user object
  );

  // Return a success response with the updated user object
  return res
    .status(200)
    .json(200, user, "Avatar image is successfully updated");
});

// Handler to update the user's cover image
const updateCoverImage = asyncHandler(async (req, res) => {
  // Get the local path of the uploaded cover image file
  const coverImageLocalPath = req.file?.path;

  // If the cover image file is not found, throw an error
  if (!coverImageLocalPath) {
    throw new ApiError(400, "Cover image file not found");
  }

  // Upload the cover image to Cloudinary (or other cloud service)
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  // If there was an error during the upload (no URL returned), throw an error
  if (!coverImage.url) {
    throw new ApiError(400, "Error while uploading cover image");
  }

  // Find the user by their ID and update the cover image URL in the database
  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        coverImage: coverImage.url, // Set the cover image URL to the uploaded one
      },
    },
    { new: true } // Return the updated user object
  );

  // Return a success response with the updated user object
  return res.status(200).json(200, user, "Cover image is successfully updated");
});

export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAvatar,
  updateCoverImage,
};
