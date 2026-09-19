const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    //Production URL
    const url =
      process.env.MONGO_URI?.trim() ||
      "mongodb://devsupport_db_user:BcaQLWLZRAz5v6W3@ac-j348rdz-shard-00-00.nfzjzch.mongodb.net:27017,ac-j348rdz-shard-00-01.nfzjzch.mongodb.net:27017,ac-j348rdz-shard-00-02.nfzjzch.mongodb.net:27017/hhc_accounts?ssl=true&replicaSet=atlas-vyw9fj-shard-0&authSource=admin&appName=Cluster0";

    //Development URL
    // const url =
    //   process.env.MONGO_TEST_URI?.trim() ||
    //   "mongodb://devsupport_db_user:testDatabase123@ac-lpuxa6r-shard-00-00.lss5etn.mongodb.net:27017,ac-lpuxa6r-shard-00-01.lss5etn.mongodb.net:27017,ac-lpuxa6r-shard-00-02.lss5etn.mongodb.net:27017/?ssl=true&replicaSet=atlas-s0bljd-shard-0&authSource=admin&appName=Cluster0";

    mongoose.set("strictQuery", false);

    await mongoose.connect(url, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      family: 4,
    });

    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
};

module.exports = connectDB;
