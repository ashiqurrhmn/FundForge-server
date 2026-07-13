import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";
import { createRemoteJWKSet, jwtVerify } from "jose-cjs";

dotenv.config();


//jwt
const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`))
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if(!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({message: 'No token provided'});
  }
  const token = authHeader.split(' ')[1];
  if(!token){
    return res.status(401).json({message: 'No token provided'});
  }

  try {
    const {payload} = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    return res.status(401).json({message: 'Invalid token'});
  }
};

const creatorVerify = async (req, res, next) => {
  if(req.user.role !== 'creator'){
    return res.status(403).json({message: 'Unauthorized'});
  }
  next();
};

const adminVerify = async (req, res, next) => {
  if(req.user.role !== 'admin'){
    return res.status(403).json({message: 'Unauthorized'});
  }
  next();
};

const supporterVerify = async (req, res, next) => {
  if(req.user.role !== 'supporter'){
    return res.status(403).json({message: 'Unauthorized'});
  }
  next();
};



// ── Stripe Initialization ──────────────────────────────────
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-06-24.dahlia",
});

// Valid credit packages (server-side validation)
const VALID_PACKAGES = [
  { credits: 100, price: 10, name: "Starter" },
  { credits: 300, price: 25, name: "Popular" },
  { credits: 800, price: 60, name: "Pro" },
  { credits: 1500, price: 110, name: "Ultimate" },
] as const;

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req: Request, res: Response) => {
  res.send("FundForge API is running!");
});

// Fetch all public/approved campaigns
app.get("/api/campaigns", async (req: Request, res: Response) => {
  try {
    const campaigns = await db
      .collection("campaigns")
      // Remove filter if you want to show all for testing, but typically { status: "approved" }
      // For now, let's fetch all so the UI isn't empty, or just approved if we want strictness.
      // The user has admin approval process so we should probably stick to approved, or all if we want.
      // Let's use { status: "approved" }
      .find({ status: "approved" })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: campaigns });
  } catch (error) {
    console.error("Error fetching campaigns:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/campaigns", verifyToken, creatorVerify, async (req: Request, res: Response) => {
  try {
    const campaignData = req.body;

    // Ensure the status is always pending for new campaigns
    campaignData.status = "pending";
    campaignData.createdAt = new Date().toISOString();

    const result = await db.collection("campaigns").insertOne(campaignData);
    res.status(201).json({ success: true, id: result.insertedId });
  } catch (error) {
    console.error("Error creating campaign:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.patch("/api/campaigns/:id", verifyToken, creatorVerify, async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    if (!ObjectId.isValid(campaignId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign ID" });
    }

    const updateData = req.body;
    // Don't allow changing _id or creator_id
    delete updateData._id;
    delete updateData.creator_id;

    const result = await db
      .collection("campaigns")
      .updateOne({ _id: new ObjectId(campaignId) }, { $set: updateData });

    if (result.matchedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }

    res.json({ success: true, message: "Campaign updated successfully" });
  } catch (error) {
    console.error("Error updating campaign:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.delete("/api/campaigns/:id", verifyToken, creatorVerify, async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    if (!ObjectId.isValid(campaignId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign ID" });
    }

    const result = await db
      .collection("campaigns")
      .deleteOne({ _id: new ObjectId(campaignId) });

    if (result.deletedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }

    res.json({ success: true, message: "Campaign deleted successfully" });
  } catch (error) {
    console.error("Error deleting campaign:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.get("/api/campaigns/creator/:id", verifyToken, creatorVerify, async (req: Request, res: Response) => {
  try {
    const creatorId = req.params.id as string;
    // Find campaigns and sort by deadline descending (-1)
    const campaigns = await db
      .collection("campaigns")
      .find({ creator_id: creatorId })
      .sort({ deadline: -1 })
      .toArray();

    res.json({ success: true, data: campaigns });
  } catch (error) {
    console.error("Error fetching creator campaigns:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Fetch all campaigns for admin
app.get("/api/campaigns/admin", verifyToken, adminVerify, async (req: Request, res: Response) => {
  try {
    const campaigns = await db
      .collection("campaigns")
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: campaigns });
  } catch (error) {
    console.error("Error fetching admin campaigns:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.get("/api/campaigns/:id", async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    if (!ObjectId.isValid(campaignId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign ID" });
    }
    const campaigns = await db
      .collection("campaigns")
      .aggregate([
        { $match: { _id: new ObjectId(campaignId) } },
        {
          $lookup: {
            from: "user",
            localField: "creator_email",
            foreignField: "email",
            as: "creator_info",
          },
        },
      ])
      .toArray();

    if (campaigns.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }

    const campaign = campaigns[0];

    // Attach user details if found
    if (campaign.creator_info && campaign.creator_info.length > 0) {
      const user = campaign.creator_info[0];
      campaign.creator_name = user.name || campaign.creator_name;
      campaign.creator_image = user.image || null;
    }

    // Clean up
    delete campaign.creator_info;
    res.json({ success: true, data: campaign });
  } catch (error) {
    console.error("Error fetching campaign:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Update campaign status
app.patch("/api/campaigns/:id/status", verifyToken, adminVerify, async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const { status } = req.body;

    if (!["approved", "rejected", "pending"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    const campaign = await db
      .collection("campaigns")
      .findOneAndUpdate(
        { _id: new ObjectId(campaignId) },
        { $set: { status } },
        { returnDocument: "after" },
      );

    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }

    if (status === "rejected") {
      await db.collection("notifications").insertOne({
        user_email: campaign.creator_email,
        title: "Campaign Rejected",
        message: `Your campaign "${campaign.campaign_title}" has been rejected by the admin.`,
        type: "campaign_rejected",
        read: false,
        createdAt: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: `Campaign status updated to ${status}`,
    });
  } catch (error) {
    console.error("Error updating campaign status:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}); // --- USER MANAGEMENT ENDPOINTS --- //

// Get all users for admin
app.get("/api/users/admin", verifyToken, adminVerify, async (req: Request, res: Response) => {
  try {
    const users = await db
      .collection<any>("user")
      .find()
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ success: true, data: users });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Update user role
app.patch("/api/users/admin/:id/role", verifyToken, adminVerify, async (req: Request, res: Response) => {
  try {
    const userId = req.params.id as string;
    const { role } = req.body;

    if (!["admin", "creator", "supporter"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }

    const user = await db
      .collection<any>("user")
      .findOneAndUpdate(
        { _id: userId },
        { $set: { role, updatedAt: new Date() } },
        { returnDocument: "after" },
      );

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.json({ success: true, message: `User role updated to ${role}` });
  } catch (error) {
    console.error("Error updating user role:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Delete user
app.delete("/api/users/admin/:id", verifyToken, adminVerify, async (req: Request, res: Response) => {
  try {
    const userId = req.params.id as string;

    const user = await db.collection<any>("user").findOne({ _id: userId });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    await db.collection<any>("user").deleteOne({ _id: userId });

    // Clean up related auth data
    await db.collection<any>("session").deleteMany({ userId: userId });
    await db.collection<any>("account").deleteMany({ userId: userId });

    res.json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ── STRIPE PAYMENT ENDPOINTS ─────────────────────────────────

// POST /api/create-payment-intent
app.post("/api/create-payment-intent", verifyToken, async (req: Request, res: Response) => {
  try {
    const { amount, credits, packageName } = req.body;

    // Validate required fields
    if (!amount || !credits || !packageName) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: amount, credits, packageName",
      });
    }

    // Validate against known packages or custom amount
    let isValid = false;

    if (packageName === "Custom") {
      // Custom amount validation: minimum 50 credits ($5), price is $0.10 per credit
      if (credits >= 50 && amount === Math.max(5, Math.ceil(credits * 0.1))) {
        isValid = true;
      }
    } else {
      const validPackage = VALID_PACKAGES.find(
        (pkg) =>
          pkg.credits === credits &&
          pkg.price === amount &&
          pkg.name === packageName,
      );
      if (validPackage) isValid = true;
    }

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid package selection or custom amount (minimum 50 credits)",
      });
    }

    // Create Payment Intent (amount in cents)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      metadata: {
        credits: credits.toString(),
        packageName,
      },
    });

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error: unknown) {
    console.error("Error creating payment intent:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create payment intent";
    res.status(500).json({ success: false, message });
  }
});

// POST /api/payments — Save payment record + increment user credits
app.post("/api/payments", verifyToken, async (req: Request, res: Response) => {
  try {
    const {
      userEmail,
      creditsPurchased,
      packageName,
      amountPaid,
      transactionId,
      paymentMethod,
    } = req.body;

    // Validate required fields
    if (
      !userEmail ||
      !creditsPurchased ||
      !packageName ||
      !amountPaid ||
      !transactionId
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required payment fields",
      });
    }

    // Create payment document
    const paymentDoc = {
      userEmail,
      creditsPurchased: Number(creditsPurchased),
      packageName,
      amountPaid: Number(amountPaid),
      transactionId,
      paymentMethod: paymentMethod || "card",
      paymentDate: new Date().toISOString(),
      status: "succeeded" as const,
    };

    // Insert payment record
    await db.collection("payments").insertOne(paymentDoc);

    // Atomically increment user credits
    await db
      .collection("user")
      .updateOne(
        { email: userEmail },
        { $inc: { credits: Number(creditsPurchased) } },
      );

    res.status(201).json({
      success: true,
      message: "Payment recorded and credits added",
      data: paymentDoc,
    });
  } catch (error: unknown) {
    console.error("Error saving payment:", error);
    const message =
      error instanceof Error ? error.message : "Failed to save payment";
    res.status(500).json({ success: false, message });
  }
});

// GET /api/payments/:email — Fetch payment history for a user
app.get("/api/payments/:email", verifyToken, async (req: Request, res: Response) => {
  try {
    const email = req.params.email as string;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email parameter is required",
      });
    }

    const payments = await db
      .collection("payments")
      .find({ userEmail: email })
      .sort({ paymentDate: -1 })
      .toArray();

    res.json({ success: true, data: payments });
  } catch (error: unknown) {
    console.error("Error fetching payments:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch payments";
    res.status(500).json({ success: false, message });
  }
});

// ── USER LOOKUP ──────────────────────────────────────────────

// GET /api/users/:email — Fetch user by email (credits, role, name)
app.get("/api/users/:email", async (req: Request, res: Response) => {
  try {
    const email = req.params.email as string;

    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email is required" });
    }

    const user = await db.collection<any>("user").findOne({ email });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.json({
      success: true,
      data: {
        name: user.name,
        email: user.email,
        role: user.role || "supporter",
        credits: user.credits || 0,
        image: user.image || null,
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching user:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch user";
    res.status(500).json({ success: false, message });
  }
});

// ── CONTRIBUTION ENDPOINTS ───────────────────────────────────

// POST /api/contributions — Create a new contribution (Pending)
app.post("/api/contributions", verifyToken, supporterVerify, async (req: Request, res: Response) => {
  try {
    const {
      campaignId,
      campaignTitle,
      supporterEmail,
      supporterName,
      creatorEmail,
      amount,
      message,
    } = req.body;

    // ── Validate required fields ──
    if (!campaignId || !supporterEmail || !amount) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: campaignId, supporterEmail, amount",
      });
    }

    const contributionAmount = Number(amount);
    if (isNaN(contributionAmount) || contributionAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Contribution amount must be a positive number",
      });
    }

    // ── Validate user exists and is a supporter ──
    const user = await db
      .collection<any>("user")
      .findOne({ email: supporterEmail });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if ((user.role || "supporter") !== "supporter") {
      return res.status(403).json({
        success: false,
        message: "Only Supporters can contribute to campaigns",
      });
    }

    // ── Validate user has enough credits ──
    const userCredits = user.credits || 0;
    if (contributionAmount > userCredits) {
      return res.status(400).json({
        success: false,
        message: `Insufficient credits. You have ${userCredits} Cr but tried to contribute ${contributionAmount} Cr`,
      });
    }

    // ── Validate campaign exists and is approved ──
    if (!ObjectId.isValid(campaignId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign ID" });
    }

    const campaign = await db
      .collection("campaigns")
      .findOne({ _id: new ObjectId(campaignId) });
    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }

    if (campaign.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "This campaign is not currently accepting contributions",
      });
    }

    // ── Validate campaign hasn't expired ──
    const deadline = new Date(campaign.deadline);
    if (deadline.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "This campaign has ended",
      });
    }

    // ── Validate minimum contribution ──
    const minContribution = campaign.minimum_contribution || 1;
    if (contributionAmount < minContribution) {
      return res.status(400).json({
        success: false,
        message: `Minimum contribution is ${minContribution} Cr`,
      });
    }

    // ── Validate does not exceed remaining goal ──
    const raisedCredits = campaign.raisedCredits || 0;
    const remaining = campaign.funding_goal - raisedCredits;
    if (contributionAmount > remaining) {
      return res.status(400).json({
        success: false,
        message: `Contribution exceeds remaining goal. Only ${remaining} Cr needed`,
      });
    }

    // ── Create contribution document ──
    const contributionDoc = {
      campaignId,
      campaignTitle: campaignTitle || campaign.campaign_title,
      supporterEmail,
      supporterName: supporterName || user.name || "Anonymous",
      creatorEmail: creatorEmail || campaign.creator_email,
      amount: contributionAmount,
      message: message || "",
      status: "Pending",
      createdAt: new Date().toISOString(),
    };

    await db.collection("contributions").insertOne(contributionDoc);

    // ── Deduct credits from supporter ──
    await db
      .collection("user")
      .updateOne(
        { email: supporterEmail },
        { $inc: { credits: -contributionAmount } },
      );

    // Do NOT increase campaign raisedCredits or backers here.
    // That only happens when the Creator approves the contribution.

    res.status(201).json({
      success: true,
      message:
        "Contribution submitted successfully! Awaiting creator approval.",
      data: contributionDoc,
    });
  } catch (error: unknown) {
    console.error("Error creating contribution:", error);
    const message =
      error instanceof Error ? error.message : "Failed to create contribution";
    res.status(500).json({ success: false, message });
  }
});

// GET /api/contributions/creator/:email — Fetch all contributions for a creator's campaigns
app.get(
  "/api/contributions/creator/:email",
  verifyToken, creatorVerify, async (req: Request, res: Response) => {
    try {
      const creatorEmail = req.params.email as string;

      if (!creatorEmail) {
        return res
          .status(400)
          .json({ success: false, message: "Creator email is required" });
      }

      const contributions = await db
        .collection("contributions")
        .find({ creatorEmail })
        .sort({ createdAt: -1 })
        .toArray();

      res.json({ success: true, data: contributions });
    } catch (error: unknown) {
      console.error("Error fetching creator contributions:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch contributions";
      res.status(500).json({ success: false, message });
    }
  },
);

// GET /api/contributions/supporter/:email — Fetch all contributions for a supporter
app.get(
  "/api/contributions/supporter/:email",
  verifyToken, supporterVerify, async (req: Request, res: Response) => {
    try {
      const supporterEmail = req.params.email as string;

      if (!supporterEmail) {
        return res
          .status(400)
          .json({ success: false, message: "Supporter email is required" });
      }

      const contributions = await db
        .collection("contributions")
        .find({ supporterEmail })
        .sort({ createdAt: -1 })
        .toArray();

      // Fetch associated campaign details
      const campaignIds = [...new Set(contributions.map((c) => c.campaignId))];
      const objectIds = campaignIds.map((id) => new ObjectId(id));

      const campaigns = await db
        .collection("campaigns")
        .find({ _id: { $in: objectIds } })
        .toArray();

      // Attach campaign info to each contribution
      const enrichedContributions = contributions.map((contribution) => {
        const campaign = campaigns.find(
          (c) => c._id.toString() === contribution.campaignId,
        );
        return {
          ...contribution,
          campaign: campaign || null,
        };
      });

      res.json({ success: true, data: enrichedContributions });
    } catch (error: unknown) {
      console.error("Error fetching supporter contributions:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch contributions";
      res.status(500).json({ success: false, message });
    }
  },
);
// GET /api/creator/dashboard/:email — Aggregate data for the creator dashboard
app.get(
  "/api/creator/dashboard/:email",
  verifyToken, creatorVerify, async (req: Request, res: Response) => {
    try {
      const { email } = req.params;
      if (!email) {
        return res
          .status(400)
          .json({ success: false, message: "Email is required" });
      }

      // 1. Fetch campaigns for this creator
      const campaigns = await db
        .collection("campaigns")
        .find({ creator_email: email })
        .toArray();

      // 2. Fetch approved contributions TO this creator
      const contributions = await db
        .collection("contributions")
        .find({ creatorEmail: email, status: "Approved" })
        .toArray();

      // Metrics
      const totalRaised = campaigns.reduce(
        (acc, c) => acc + (c.raisedCredits || 0),
        0,
      );
      const activeCampaigns = campaigns.filter(
        (c) => new Date(c.deadline) > new Date(),
      ).length;
      const uniqueBackers = new Set(contributions.map((c) => c.supporterEmail));
      const totalBackers = uniqueBackers.size;
      const totalViews = totalBackers * 43; // Mocking views based on backers

      // Recent backers (sort by createdAt desc, take 4 unique backers)
      const seenEmails = new Set();
      const uniqueRecentContributions = contributions
        .sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        )
        .filter((c) => {
          if (seenEmails.has(c.supporterEmail)) return false;
          seenEmails.add(c.supporterEmail);
          return true;
        });

      const recentBackers = uniqueRecentContributions.slice(0, 4).map((c) => {
        const campaign = campaigns.find(
          (camp) => camp._id.toString() === c.campaignId,
        );
        return {
          id: c._id.toString(),
          name: c.supporterName || c.supporterEmail.split("@")[0],
          amount: c.amount,
          campaign: campaign
            ? campaign.campaign_title
            : c.campaignTitle || "Unknown Campaign",
          time: new Date(c.createdAt).toLocaleDateString(),
          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(c.supporterName || c.supporterEmail)}&background=random`,
        };
      });

      // Chart Data (6 rolling months)
      const today = new Date();
      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      const chartData = [];

      for (let i = 5; i >= 0; i--) {
        const targetMonth = today.getMonth() - i;
        const targetYear = today.getFullYear() + Math.floor(targetMonth / 12);
        const normalizedMonth = ((targetMonth % 12) + 12) % 12;

        const monthStart = new Date(targetYear, normalizedMonth, 1);
        const monthEnd = new Date(
          targetYear,
          normalizedMonth + 1,
          0,
          23,
          59,
          59,
          999,
        );

        const monthContributions = contributions.filter((c) => {
          const d = new Date(c.createdAt);
          return d >= monthStart && d <= monthEnd;
        });

        const sum = monthContributions.reduce(
          (acc, curr) => acc + (curr.amount || 0),
          0,
        );

        chartData.push({
          month: months[normalizedMonth],
          impact: sum,
        });
      }

      res.json({
        success: true,
        data: {
          metrics: {
            totalRaised,
            totalBackers,
            activeCampaigns,
            totalViews,
            raisedTrend: "+15%", // Mock trend
            viewsTrend: "+34%", // Mock trend
          },
          recentBackers,
          chartData,
        },
      });
    } catch (error) {
      console.error("Dashboard error:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Server error fetching creator dashboard",
        });
    }
  },
);

// GET /api/supporter/dashboard/:email — Aggregate data for the supporter dashboard
app.get(
  "/api/supporter/dashboard/:email",
  verifyToken, supporterVerify, async (req: Request, res: Response) => {
    try {
      const email = req.params.email as string;

      if (!email) {
        return res
          .status(400)
          .json({ success: false, message: "Email is required" });
      }

      // 1. Fetch User (for available credits)
      const user = await db.collection("user").findOne({ email });
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      const availableCredit = user.credits || 0;

      // 2. Fetch all Approved contributions for this supporter
      const contributions = await db
        .collection("contributions")
        .find({ supporterEmail: email, status: "Approved" })
        .toArray();

      // 3. Calculate Metrics
      let totalImpact = 0;
      let monthlyContributions = 0;
      const impactByCategory: Record<string, number> = {};
      const supportedCampaignIds = new Set<string>();

      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();

      for (const contribution of contributions) {
        const amount = contribution.amount || 0;
        totalImpact += amount;

        const date = new Date(contribution.createdAt);
        if (
          date.getMonth() === currentMonth &&
          date.getFullYear() === currentYear
        ) {
          monthlyContributions += amount;
        }

        supportedCampaignIds.add(contribution.campaignId);
      }

      // 4. Fetch Supported Campaigns
      const objectIds = Array.from(supportedCampaignIds).map(
        (id) => new ObjectId(id),
      );
      const supportedCampaigns = await db
        .collection("campaigns")
        .find({ _id: { $in: objectIds } })
        .toArray();

      // Calculate Impact by Category (using campaign data)
      for (const contribution of contributions) {
        const amount = contribution.amount || 0;
        const campaign = supportedCampaigns.find(
          (c) => c._id.toString() === contribution.campaignId,
        );
        if (campaign && campaign.category) {
          impactByCategory[campaign.category] =
            (impactByCategory[campaign.category] || 0) + amount;
        }
      }

      // Convert impactByCategory to an array of objects
      const impactSummary = Object.entries(impactByCategory)
        .map(([category, amount]) => ({
          category,
          amount,
        }))
        .sort((a, b) => b.amount - a.amount);

      // Calculate Averages & Chart Data
      let avgImpactPerMonth = 0;
      let avgImpactPerDay = 0;

      // Generate last 6 months for chart data
      const monthNames = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      const chartData = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        chartData.push({
          name: monthNames[d.getMonth()],
          month: d.getMonth(),
          year: d.getFullYear(),
          amount: 0,
        });
      }

      if (contributions.length > 0) {
        // Find earliest contribution date
        const earliestDate = new Date(
          Math.min(
            ...contributions.map((c) => new Date(c.createdAt).getTime()),
          ),
        );

        const daysDiff = Math.max(
          1,
          Math.ceil(
            (now.getTime() - earliestDate.getTime()) / (1000 * 3600 * 24),
          ),
        );
        const monthsDiff = Math.max(1, Math.ceil(daysDiff / 30));

        avgImpactPerMonth = Math.round(totalImpact / monthsDiff);
        avgImpactPerDay = Math.round(totalImpact / daysDiff);

        // Populate chart data
        for (const c of contributions) {
          const cDate = new Date(c.createdAt);
          const cMonth = cDate.getMonth();
          const cYear = cDate.getFullYear();

          const dataPoint = chartData.find(
            (d) => d.month === cMonth && d.year === cYear,
          );
          if (dataPoint) {
            dataPoint.amount += c.amount || 0;
          }
        }
      }

      // 5. Fetch Trending Campaigns (Top 3 by raisedCredits)
      const trendingCampaigns = await db
        .collection("campaigns")
        .find({ status: "approved" })
        .sort({ raisedCredits: -1 })
        .limit(3)
        .toArray();

      res.json({
        success: true,
        data: {
          metrics: {
            totalImpact,
            monthlyContributions,
            availableCredit,
            avgImpactPerMonth,
            avgImpactPerDay,
          },
          supportedCampaigns,
          trendingCampaigns,
          impactSummary,
          chartData,
        },
      });
    } catch (error: unknown) {
      console.error("Error fetching supporter dashboard data:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch dashboard data";
      res.status(500).json({ success: false, message });
    }
  },
);

// PATCH /api/contributions/:id/status — Approve or reject a contribution
app.patch(
  "/api/contributions/:id/status",
  verifyToken, creatorVerify, async (req: Request, res: Response) => {
    try {
      const contributionId = req.params.id as string;
      const { status } = req.body;

      if (!ObjectId.isValid(contributionId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid contribution ID" });
      }

      if (!["Approved", "Rejected"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Status must be "Approved" or "Rejected"',
        });
      }

      // Find the contribution
      const contribution = await db.collection<any>("contributions").findOne({
        _id: new ObjectId(contributionId),
      });

      if (!contribution) {
        return res
          .status(404)
          .json({ success: false, message: "Contribution not found" });
      }

      if (contribution.status !== "Pending") {
        return res.status(400).json({
          success: false,
          message: `This contribution is already ${contribution.status}`,
        });
      }

      // Update contribution status
      await db
        .collection("contributions")
        .updateOne(
          { _id: new ObjectId(contributionId) },
          { $set: { status, updatedAt: new Date().toISOString() } },
        );

      if (status === "Approved") {
        // ── Increase campaign raisedCredits ──
        await db
          .collection("campaigns")
          .updateOne(
            { _id: new ObjectId(contribution.campaignId) },
            { $inc: { raisedCredits: contribution.amount } },
          );

        // ── Increase backers by 1 only if this is the first approved contribution from this supporter ──
        const previousApproved = await db
          .collection("contributions")
          .countDocuments({
            campaignId: contribution.campaignId,
            supporterEmail: contribution.supporterEmail,
            status: "Approved",
            _id: { $ne: new ObjectId(contributionId) },
          });

        if (previousApproved === 0) {
          await db
            .collection("campaigns")
            .updateOne(
              { _id: new ObjectId(contribution.campaignId) },
              { $inc: { backers: 1 } },
            );
        }

        // Send notification to supporter
        await db.collection("notifications").insertOne({
          user_email: contribution.supporterEmail,
          title: "Contribution Approved!",
          message: `Your contribution of ${contribution.amount} Cr to "${contribution.campaignTitle}" has been approved by the creator.`,
          type: "contribution_approved",
          read: false,
          createdAt: new Date().toISOString(),
        });
      } else if (status === "Rejected") {
        // ── Refund credits to supporter ──
        await db
          .collection("user")
          .updateOne(
            { email: contribution.supporterEmail },
            { $inc: { credits: contribution.amount } },
          );

        // Send notification to supporter
        await db.collection("notifications").insertOne({
          user_email: contribution.supporterEmail,
          title: "Contribution Rejected",
          message: `Your contribution of ${contribution.amount} Cr to "${contribution.campaignTitle}" has been rejected. Credits have been refunded to your account.`,
          type: "contribution_rejected",
          read: false,
          createdAt: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        message: `Contribution ${status.toLowerCase()} successfully`,
      });
    } catch (error: unknown) {
      console.error("Error updating contribution status:", error);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update contribution status";
      res.status(500).json({ success: false, message });
    }
  },
);

// ═══════════════════════════════════════════════════════════════
// ══  WITHDRAWAL SYSTEM ROUTES
// ═══════════════════════════════════════════════════════════════

const CREDITS_PER_USD = 20;

// GET /api/withdrawals/balance/:email — Calculate available, withdrawn, pending credits & USD
app.get(
  "/api/withdrawals/balance/:email",
  verifyToken, creatorVerify, async (req: Request, res: Response) => {
    try {
      const { email } = req.params;
      if (!email) {
        return res
          .status(400)
          .json({ success: false, message: "Email is required" });
      }

      // Verify user is a creator
      const user = await db.collection("user").findOne({ email });
      if (!user || user.role !== "creator") {
        return res
          .status(403)
          .json({
            success: false,
            message: "Only creators can access withdrawal balance",
          });
      }

      // Sum all approved contributions for this creator
      const approvedContributions = await db
        .collection("contributions")
        .find({ creatorEmail: email, status: "Approved" })
        .toArray();
      const totalApprovedCredits = approvedContributions.reduce(
        (acc, c) => acc + (c.amount || 0),
        0,
      );

      // Sum approved withdrawals
      const approvedWithdrawals = await db
        .collection("withdrawals")
        .find({ creatorEmail: email, status: "Approved" })
        .toArray();
      const withdrawnCredits = approvedWithdrawals.reduce(
        (acc, w) => acc + (w.withdrawalCredits || 0),
        0,
      );

      // Sum pending withdrawals
      const pendingWithdrawals = await db
        .collection("withdrawals")
        .find({ creatorEmail: email, status: "Pending" })
        .toArray();
      const pendingCredits = pendingWithdrawals.reduce(
        (acc, w) => acc + (w.withdrawalCredits || 0),
        0,
      );

      const availableCredits =
        totalApprovedCredits - withdrawnCredits - pendingCredits;

      res.json({
        success: true,
        data: {
          totalApprovedCredits,
          availableCredits: Math.max(0, availableCredits),
          withdrawnCredits,
          pendingCredits,
          availableUSD: Math.max(0, availableCredits) / CREDITS_PER_USD,
          withdrawnUSD: withdrawnCredits / CREDITS_PER_USD,
          pendingUSD: pendingCredits / CREDITS_PER_USD,
        },
      });
    } catch (error) {
      console.error("Error fetching withdrawal balance:", error);
      res
        .status(500)
        .json({ success: false, message: "Server error fetching balance" });
    }
  },
);

// POST /api/withdrawals — Create withdrawal request
app.post("/api/withdrawals", verifyToken, creatorVerify, async (req: Request, res: Response) => {
  try {
    const { email, withdrawalCredits, paymentMethod, paymentDetails } =
      req.body;

    if (!email || !withdrawalCredits || !paymentMethod || !paymentDetails) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    // Verify user is a creator
    const user = await db.collection("user").findOne({ email });
    if (!user || user.role !== "creator") {
      return res
        .status(403)
        .json({
          success: false,
          message: "Only creators can request withdrawals",
        });
    }

    const credits = Number(withdrawalCredits);
    if (isNaN(credits) || credits <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid withdrawal amount" });
    }

    // Minimum 200 credits
    if (credits < 200) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Minimum withdrawal is 200 Credits ($10)",
        });
    }

    // Must be multiple of 20
    if (credits % 20 !== 0) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Withdrawal amount must be a multiple of 20 Credits",
        });
    }

    // Payment details must not be empty
    if (!paymentDetails.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Payment details are required" });
    }

    // Check for existing pending withdrawal
    const existingPending = await db.collection("withdrawals").findOne({
      creatorEmail: email,
      status: "Pending",
    });
    if (existingPending) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "You already have a pending withdrawal request. Please wait for it to be processed or cancel it.",
        });
    }

    // Recalculate available balance server-side
    const approvedContributions = await db
      .collection("contributions")
      .find({ creatorEmail: email, status: "Approved" })
      .toArray();
    const totalApprovedCredits = approvedContributions.reduce(
      (acc, c) => acc + (c.amount || 0),
      0,
    );

    const approvedWithdrawals = await db
      .collection("withdrawals")
      .find({ creatorEmail: email, status: "Approved" })
      .toArray();
    const withdrawnCredits = approvedWithdrawals.reduce(
      (acc, w) => acc + (w.withdrawalCredits || 0),
      0,
    );

    const pendingWithdrawalsSum = await db
      .collection("withdrawals")
      .find({ creatorEmail: email, status: "Pending" })
      .toArray();
    const pendingCredits = pendingWithdrawalsSum.reduce(
      (acc, w) => acc + (w.withdrawalCredits || 0),
      0,
    );

    const availableCredits =
      totalApprovedCredits - withdrawnCredits - pendingCredits;

    if (credits > availableCredits) {
      return res
        .status(400)
        .json({
          success: false,
          message: `Insufficient balance. You have ${availableCredits} available credits.`,
        });
    }

    // Create withdrawal document
    const withdrawalDoc = {
      creatorId: user._id.toString(),
      creatorName: user.name || "Unknown",
      creatorEmail: email,
      withdrawalCredits: credits,
      withdrawalAmountUSD: credits / CREDITS_PER_USD,
      conversionRate: CREDITS_PER_USD,
      paymentMethod,
      paymentDetails: paymentDetails.trim(),
      status: "Pending",
      requestedAt: new Date().toISOString(),
      approvedAt: null,
      rejectedAt: null,
      adminNote: "",
      transactionReference: "",
    };

    await db.collection("withdrawals").insertOne(withdrawalDoc);

    // Notify all admins
    const admins = await db
      .collection("user")
      .find({ role: "admin" })
      .toArray();
    for (const admin of admins) {
      await db.collection("notifications").insertOne({
        user_email: admin.email,
        title: "New Withdrawal Request",
        message: `${user.name || email} has requested a withdrawal of ${credits} Cr ($${(credits / CREDITS_PER_USD).toFixed(2)}) via ${paymentMethod}.`,
        type: "withdrawal_request",
        read: false,
        createdAt: new Date().toISOString(),
      });
    }

    res.status(201).json({
      success: true,
      message: "Withdrawal request submitted successfully!",
      data: withdrawalDoc,
    });
  } catch (error) {
    console.error("Error creating withdrawal:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Server error creating withdrawal request",
      });
  }
});

// GET /api/withdrawals/creator/:email — Return creator's withdrawal history
app.get(
  "/api/withdrawals/creator/:email",
  verifyToken, creatorVerify, async (req: Request, res: Response) => {
    try {
      const { email } = req.params;
      if (!email) {
        return res
          .status(400)
          .json({ success: false, message: "Email is required" });
      }

      const withdrawals = await db
        .collection("withdrawals")
        .find({ creatorEmail: email })
        .sort({ requestedAt: -1 })
        .toArray();

      res.json({ success: true, data: withdrawals });
    } catch (error) {
      console.error("Error fetching creator withdrawals:", error);
      res
        .status(500)
        .json({ success: false, message: "Server error fetching withdrawals" });
    }
  },
);

// PATCH /api/withdrawals/:id/cancel — Allow creator to cancel pending request
app.patch(
  "/api/withdrawals/:id/cancel",
  verifyToken, creatorVerify, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { email } = req.body;

      if (!ObjectId.isValid(id as string)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid withdrawal ID" });
      }

      const withdrawal = await db
        .collection("withdrawals")
        .findOne({ _id: new ObjectId(id as string) });
      if (!withdrawal) {
        return res
          .status(404)
          .json({ success: false, message: "Withdrawal not found" });
      }

      if (withdrawal.creatorEmail !== email) {
        return res
          .status(403)
          .json({
            success: false,
            message: "You can only cancel your own withdrawals",
          });
      }

      if (withdrawal.status !== "Pending") {
        return res
          .status(400)
          .json({
            success: false,
            message: "Only pending withdrawals can be cancelled",
          });
      }

      await db
        .collection("withdrawals")
        .updateOne(
          { _id: new ObjectId(id as string) },
          { $set: { status: "Cancelled" } },
        );

      res.json({
        success: true,
        message: "Withdrawal request cancelled successfully",
      });
    } catch (error) {
      console.error("Error cancelling withdrawal:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Server error cancelling withdrawal",
        });
    }
  },
);

// GET /api/withdrawals/admin — Return all withdrawal requests for admin
app.get("/api/withdrawals/admin", verifyToken, adminVerify, async (req: Request, res: Response) => {
  try {
    const withdrawals = await db
      .collection("withdrawals")
      .find({})
      .sort({ requestedAt: -1 })
      .toArray();

    res.json({ success: true, data: withdrawals });
  } catch (error) {
    console.error("Error fetching admin withdrawals:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching withdrawals" });
  }
});

// PATCH /api/withdrawals/:id/status — Admin approve/reject
app.patch(
  "/api/withdrawals/:id/status",
  verifyToken, adminVerify, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, adminNote, transactionReference } = req.body;

      if (!ObjectId.isValid(id as string)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid withdrawal ID" });
      }

      if (!["Approved", "Rejected"].includes(status)) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Status must be Approved or Rejected",
          });
      }

      const withdrawal = await db
        .collection("withdrawals")
        .findOne({ _id: new ObjectId(id as string) });
      if (!withdrawal) {
        return res
          .status(404)
          .json({ success: false, message: "Withdrawal not found" });
      }

      if (withdrawal.status !== "Pending") {
        return res
          .status(400)
          .json({
            success: false,
            message: "Only pending withdrawals can be updated",
          });
      }

      const updateFields: any = {
        status,
        adminNote: adminNote || "",
      };

      if (status === "Approved") {
        updateFields.approvedAt = new Date().toISOString();
        updateFields.transactionReference = transactionReference || "";

        // Notify creator of approval
        await db.collection("notifications").insertOne({
          user_email: withdrawal.creatorEmail,
          title: "Withdrawal Approved!",
          message: `Your withdrawal of ${withdrawal.withdrawalCredits} Cr ($${withdrawal.withdrawalAmountUSD.toFixed(2)}) has been approved.${transactionReference ? ` Transaction Ref: ${transactionReference}` : ""}`,
          type: "withdrawal_approved",
          read: false,
          createdAt: new Date().toISOString(),
        });
      } else if (status === "Rejected") {
        updateFields.rejectedAt = new Date().toISOString();

        // Notify creator of rejection
        await db.collection("notifications").insertOne({
          user_email: withdrawal.creatorEmail,
          title: "Withdrawal Rejected",
          message: `Your withdrawal of ${withdrawal.withdrawalCredits} Cr ($${withdrawal.withdrawalAmountUSD.toFixed(2)}) has been rejected.${adminNote ? ` Reason: ${adminNote}` : ""}`,
          type: "withdrawal_rejected",
          read: false,
          createdAt: new Date().toISOString(),
        });
      }

      await db
        .collection("withdrawals")
        .updateOne({ _id: new ObjectId(id as string) }, { $set: updateFields });

      res.json({
        success: true,
        message: `Withdrawal ${status.toLowerCase()} successfully`,
      });
    } catch (error) {
      console.error("Error updating withdrawal status:", error);
      res
        .status(500)
        .json({ success: false, message: "Server error updating withdrawal" });
    }
  },
);

// GET /api/admin/dashboard/stats — Admin dashboard global stats
app.get("/api/admin/dashboard/stats", verifyToken, adminVerify, async (req: Request, res: Response) => {
  try {
    const totalUsers = await db.collection("user").countDocuments();
    const pendingCampaigns = await db
      .collection("campaigns")
      .countDocuments({ status: "pending" });
    const activeCampaigns = await db
      .collection("campaigns")
      .countDocuments({ status: "approved" });

    // Sum all approved contributions globally
    const approvedContributions = await db
      .collection("contributions")
      .find({ status: "Approved" })
      .toArray();
    const totalContributions = approvedContributions.reduce(
      (acc, c) => acc + (c.amount || 0),
      0,
    );
    const platformIncomeUSD = totalContributions / 20;

    // Get 5 recent users
    const recentUsers = await db
      .collection("user")
      .find({})
      .sort({ _id: -1 })
      .limit(5)
      .toArray();

    // Get 5 recent campaigns
    const recentCampaigns = await db
      .collection("campaigns")
      .find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    res.json({
      success: true,
      data: {
        totalUsers,
        pendingCampaigns,
        activeCampaigns,
        totalContributions,
        platformIncomeUSD,
        recentUsers,
        recentCampaigns,
      },
    });
  } catch (error) {
    console.error("Error fetching admin dashboard stats:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching stats" });
  }
});

// GET /api/admin/reports — Admin analytics for charts
app.get("/api/admin/reports", verifyToken, adminVerify, async (req: Request, res: Response) => {
  try {
    // 1. Revenue Over Time
    const approvedContributions = await db
      .collection("contributions")
      .find({ status: "Approved" })
      .toArray();

    const revenueMap: Record<string, number> = {};
    approvedContributions.forEach((c) => {
      // Handle different date formats (string vs Date object)
      const dateStr = c.createdAt
        ? new Date(c.createdAt).toISOString()
        : new Date().toISOString();
      // Format to "MMM YYYY" (e.g. "Jul 2026")
      const dateObj = new Date(dateStr);
      const monthYear = dateObj.toLocaleString("default", {
        month: "short",
        year: "numeric",
      });

      revenueMap[monthYear] =
        (revenueMap[monthYear] || 0) + (c.amount || 0) / 20; // Platform income in USD
    });

    // Convert map to array and sort chronologically (rough sort by parsing back)
    const revenueOverTime = Object.entries(revenueMap)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => new Date(a.name).getTime() - new Date(b.name).getTime());

    // 2. Campaigns by Category
    const allCampaigns = await db.collection("campaigns").find({}).toArray();
    const categoryMap: Record<string, number> = {};
    allCampaigns.forEach((c) => {
      const cat = c.category || "Uncategorized";
      categoryMap[cat] = (categoryMap[cat] || 0) + 1;
    });
    const campaignsByCategory = Object.entries(categoryMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value); // Sort descending by value

    // 3. Users by Role
    const allUsers = await db.collection("user").find({}).toArray();
    const roleMap: Record<string, number> = {};
    allUsers.forEach((u) => {
      const role = u.role || "supporter"; // Default if missing
      const displayRole = role.charAt(0).toUpperCase() + role.slice(1);
      roleMap[displayRole] = (roleMap[displayRole] || 0) + 1;
    });
    const usersByRole = Object.entries(roleMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    res.json({
      success: true,
      data: {
        revenueOverTime,
        campaignsByCategory,
        usersByRole,
      },
    });
  } catch (error) {
    console.error("Error fetching admin reports:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching reports" });
  }
});

// GET /api/admin/contributions — Get all contributions across the platform
app.get("/api/admin/contributions", verifyToken, adminVerify, async (req: Request, res: Response) => {
  try {
    const contributions = await db
      .collection("contributions")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: contributions });
  } catch (error) {
    console.error("Error fetching admin contributions:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /api/admin/purchases — Get all credit purchases across the platform
app.get("/api/admin/purchases", verifyToken, adminVerify, async (req: Request, res: Response) => {
  try {
    const purchases = await db
      .collection("payments")
      .find({})
      .sort({ paymentDate: -1 })
      .toArray();

    res.json({ success: true, data: purchases });
  } catch (error) {
    console.error("Error fetching admin purchases:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

const client = new MongoClient(process.env.MONGO_URI!);
export const db = client.db("fundforge");

export async function connectToMongoDB() {
  try {
    await client.connect();
    await db.command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
    return client;
  } catch (err) {
    console.dir(err);
  }
}

// Call this only when your application terminates
export async function disconnectFromMongoDB() {
  await client.close();
}

connectToMongoDB()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  })
  .catch(console.dir);
