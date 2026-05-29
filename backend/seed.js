const connectDB = require("./src/config/db");
const Branch = require("./src/models/Branch");
const User = require("./src/models/User");
const Vendor = require("./src/models/Vendor");
const ExpenseCategory = require("./src/models/ExpenseCategory");
const PaymentRequest = require("./src/models/PaymentRequest");
const { ROLES } = require("./src/config/constants");

const seed = async () => {
  await connectDB();

  try {
    console.log("Clearing existing test data...");
    await Promise.all([
      Branch.deleteMany({}),
      User.deleteMany({}),
      Vendor.deleteMany({}),
      ExpenseCategory.deleteMany({}),
      PaymentRequest.deleteMany({}),
    ]);

    const branches = await Branch.create([
      {
        name: "Healing Hands Main Branch",
        code: "HHMAIN",
        location: "Downtown",
      },
      {
        name: "Healing Hands East Branch",
        code: "HHEAST",
        location: "East District",
      },
    ]);

    const [mainBranch, eastBranch] = branches;

    const users = await User.create([
      {
        name: "Super Admin",
        email: "admin@healinghands.local",
        mobile: "9000000000",
        role: ROLES.SUPER_ADMIN,
        branches: [mainBranch._id],
      },
      {
        name: "Branch User",
        email: "branch1@healinghands.local",
        mobile: "9000000001",
        role: ROLES.BRANCH_USER,
        branches: [mainBranch._id],
      },
      {
        name: "Accounts User",
        email: "accounts@healinghands.local",
        mobile: "9000000002",
        role: ROLES.ACCOUNTS,
        branches: [mainBranch._id, eastBranch._id],
      },
    ]);

    const [superAdmin, branchUser, accountsUser] = users;

    const categories = await ExpenseCategory.create([
      {
        name: "Medical Supplies",
        code: "MED_SUPPLIES",
        type: "Revenue",
        description: "Consumable medical goods and supplies",
      },
      {
        name: "Office Expenses",
        code: "OFFICE_EXPENSES",
        type: "Revenue",
        description: "General office and administrative expenses",
      },
      {
        name: "Maintenance",
        code: "MAINTENANCE",
        type: "Capital",
        description: "Repair and maintenance costs",
      },
    ]);

    const vendors = await Vendor.create([
      {
        branch: mainBranch._id,
        vendorName: "CarePlus Diagnostics",
        contactPerson: "Priya Sharma",
        mobile: "9876543210",
        email: "contact@careplus.com",
        companyName: "CarePlus Diagnostics Pvt Ltd",
        panNumber: "ABCDE1234F",
        vendorCategory: "Service Vendors",
        accountHolderName: "CarePlus Diagnostics",
        bankName: "State Bank of India",
        accountNumber: "123456789012",
        ifscCode: "SBIN0001234",
        createdBy: branchUser._id,
      },
      {
        branch: eastBranch._id,
        vendorName: "EastCare Equipments",
        contactPerson: "Arun Kumar",
        mobile: "9123456780",
        email: "arun@eastcare.com",
        companyName: "EastCare Equipments LLP",
        panNumber: "XYZAB9876N",
        vendorCategory: "Equipment Vendors",
        accountHolderName: "EastCare Equipments",
        bankName: "HDFC Bank",
        accountNumber: "987654321098",
        ifscCode: "HDFC0005678",
        createdBy: accountsUser._id,
      },
    ]);

    await PaymentRequest.create([
      {
        requestId: "PMS-000001",
        branch: mainBranch._id,
        vendor: vendors[0]._id,
        expenseType: "Revenue",
        expenseCategory: categories[0]._id,
        amount: 50000,
        gstAmount: 9000,
        tdsAmount: 0,
        netPayable: 59000,
        invoiceNumber: "INV-1001",
        invoiceDate: new Date("2026-05-01"),
        dueDate: new Date("2026-05-15"),
        description: "Lab equipment consumables",
        priority: "Normal",
        attachments: [
          {
            name: "Invoice 1001",
            url: "https://example.com/invoice-1001.pdf",
            type: "invoice",
          },
        ],
        status: "Submitted",
        createdBy: branchUser._id,
      },
      {
        requestId: "PMS-000002",
        branch: eastBranch._id,
        vendor: vendors[1]._id,
        expenseType: "Capital",
        expenseCategory: categories[1]._id,
        amount: 120000,
        gstAmount: 21600,
        tdsAmount: 0,
        netPayable: 141600,
        invoiceNumber: "INV-1002",
        invoiceDate: new Date("2026-05-02"),
        dueDate: new Date("2026-05-22"),
        description: "New oxygen concentrator purchase",
        priority: "Urgent",
        attachments: [
          {
            name: "Quotation 1002",
            url: "https://example.com/quote-1002.pdf",
            type: "quotation",
          },
        ],
        status: "Draft",
        createdBy: accountsUser._id,
      },
    ]);

    console.log("Dummy test data seeded successfully.");
    console.log(
      "Login with email: branch1@healinghands.local and request OTP to authenticate.",
    );
  } catch (error) {
    console.error("Seed error:", error);
    process.exit(1);
  }

  process.exit(0);
};

seed();
