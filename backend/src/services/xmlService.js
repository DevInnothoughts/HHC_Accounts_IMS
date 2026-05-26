const { create } = require("xmlbuilder2");

const generatePaymentXML = (request, vendor) => {
  const xml = create({ version: "1.0", encoding: "UTF-8" })
    .ele("PaymentInstruction")
    .ele("Header")
    .ele("RequestId")
    .txt(request.requestId)
    .up()
    .ele("GeneratedAt")
    .txt(new Date().toISOString())
    .up()
    .ele("TotalAmount")
    .txt(request.netPayable.toString())
    .up()
    .up()
    .ele("Beneficiary")
    .ele("Name")
    .txt(vendor.accountHolderName)
    .up()
    .ele("AccountNumber")
    .txt(vendor.accountNumber)
    .up()
    .ele("IFSCCode")
    .txt(vendor.ifscCode)
    .up()
    .ele("BankName")
    .txt(vendor.bankName)
    .up()
    .ele("Amount")
    .txt(request.netPayable.toString())
    .up()
    .ele("Narration")
    .txt(`${request.requestId} - ${request.description || "Payment"}`)
    .up()
    .ele("PaymentReference")
    .txt(request.requestId)
    .up()
    .up()
    .up()
    .end({ prettyPrint: true });

  return xml;
};

module.exports = { generatePaymentXML };
