const asyncHandler = (requestHandler) => {
  return (req, res, next) => {
    Promise.resolve(requestHandler(req, res, next)).catch((err) => next(err));
  };
};

// const handler = (handleReq) => async (req, res, next) => {
//   try {
//     await handleReq(req, res, next);
//   } catch (err) {
//     res.status(err.code || 500).json({
//       success: false,
//       massage: err.massage,
//     });
//   }
// };

export { asyncHandler };
