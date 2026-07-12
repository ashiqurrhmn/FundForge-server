import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import Stripe from 'stripe';

dotenv.config();

// ── Stripe Initialization ──────────────────────────────────
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-06-24.dahlia',
});

// Valid credit packages (server-side validation)
const VALID_PACKAGES = [
  { credits: 100,  price: 10,  name: 'Starter' },
  { credits: 300,  price: 25,  name: 'Popular' },
  { credits: 800,  price: 60,  name: 'Pro' },
  { credits: 1500, price: 110, name: 'Ultimate' },
] as const;

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.send('FundForge API is running!');
});

// Fetch all public/approved campaigns
app.get('/api/campaigns', async (req: Request, res: Response) => {
  try {
    const campaigns = await db.collection("campaigns")
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

app.post('/api/campaigns', async (req: Request, res: Response) => {
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

app.patch('/api/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    if (!ObjectId.isValid(campaignId)) {
      return res.status(400).json({ success: false, message: "Invalid campaign ID" });
    }
    
    const updateData = req.body;
    // Don't allow changing _id or creator_id
    delete updateData._id;
    delete updateData.creator_id;

    const result = await db.collection("campaigns").updateOne(
      { _id: new ObjectId(campaignId) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    res.json({ success: true, message: "Campaign updated successfully" });
  } catch (error) {
    console.error("Error updating campaign:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.delete('/api/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    if (!ObjectId.isValid(campaignId)) {
      return res.status(400).json({ success: false, message: "Invalid campaign ID" });
    }
    
    const result = await db.collection("campaigns").deleteOne({ _id: new ObjectId(campaignId) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }
    
    res.json({ success: true, message: "Campaign deleted successfully" });
  } catch (error) {
    console.error("Error deleting campaign:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.get('/api/campaigns/creator/:id', async (req: Request, res: Response) => {
  try {
    const creatorId = req.params.id as string;
    // Find campaigns and sort by deadline descending (-1)
    const campaigns = await db.collection("campaigns")
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
app.get('/api/campaigns/admin', async (req: Request, res: Response) => {
  try {
    const campaigns = await db.collection("campaigns")
      .find()
      .sort({ createdAt: -1 })
      .toArray();
      
    res.json({ success: true, data: campaigns });
  } catch (error) {
    console.error("Error fetching admin campaigns:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.get('/api/campaigns/:id', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    if (!ObjectId.isValid(campaignId)) {
      return res.status(400).json({ success: false, message: "Invalid campaign ID" });
    }
    const campaigns = await db.collection("campaigns").aggregate([
      { $match: { _id: new ObjectId(campaignId) } },
      {
        $lookup: {
          from: "user",
          localField: "creator_email",
          foreignField: "email",
          as: "creator_info"
        }
      }
    ]).toArray();

    if (campaigns.length === 0) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
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
app.patch('/api/campaigns/:id/status', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id as string;
    const { status } = req.body;

    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const campaign = await db.collection("campaigns").findOneAndUpdate(
      { _id: new ObjectId(campaignId) },
      { $set: { status } },
      { returnDocument: "after" }
    );

    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    if (status === "rejected") {
      await db.collection("notifications").insertOne({
        user_email: campaign.creator_email,
        title: "Campaign Rejected",
        message: `Your campaign "${campaign.campaign_title}" has been rejected by the admin.`,
        type: "campaign_rejected",
        read: false,
        createdAt: new Date().toISOString()
      });
    }

    res.json({ success: true, message: `Campaign status updated to ${status}` });
  } catch (error) {
    console.error("Error updating campaign status:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});// --- USER MANAGEMENT ENDPOINTS --- //

// Get all users for admin
app.get('/api/users/admin', async (req: Request, res: Response) => {
  try {
    const users = await db.collection<any>("user").find().sort({ createdAt: -1 }).toArray();
    res.json({ success: true, data: users });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Update user role
app.patch('/api/users/admin/:id/role', async (req: Request, res: Response) => {
  try {
    const userId = req.params.id as string;
    const { role } = req.body;

    if (!["admin", "creator", "supporter"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }

    const user = await db.collection<any>("user").findOneAndUpdate(
      { _id: userId },
      { $set: { role, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, message: `User role updated to ${role}` });
  } catch (error) {
    console.error("Error updating user role:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Delete user
app.delete('/api/users/admin/:id', async (req: Request, res: Response) => {
  try {

    const userId = req.params.id as string;

    const user = await db.collection<any>("user").findOne({ _id: userId });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
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
app.post('/api/create-payment-intent', async (req: Request, res: Response) => {
  try {
    const { amount, credits, packageName } = req.body;

    // Validate required fields
    if (!amount || !credits || !packageName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: amount, credits, packageName',
      });
    }

    // Validate against known packages or custom amount
    let isValid = false;
    
    if (packageName === 'Custom') {
      // Custom amount validation: minimum 50 credits ($5), price is $0.10 per credit
      if (credits >= 50 && amount === Math.max(5, Math.ceil(credits * 0.1))) {
        isValid = true;
      }
    } else {
      const validPackage = VALID_PACKAGES.find(
        (pkg) => pkg.credits === credits && pkg.price === amount && pkg.name === packageName
      );
      if (validPackage) isValid = true;
    }

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid package selection or custom amount (minimum 50 credits)',
      });
    }

    // Create Payment Intent (amount in cents)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
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
    console.error('Error creating payment intent:', error);
    const message = error instanceof Error ? error.message : 'Failed to create payment intent';
    res.status(500).json({ success: false, message });
  }
});

// POST /api/payments — Save payment record + increment user credits
app.post('/api/payments', async (req: Request, res: Response) => {
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
    if (!userEmail || !creditsPurchased || !packageName || !amountPaid || !transactionId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required payment fields',
      });
    }

    // Create payment document
    const paymentDoc = {
      userEmail,
      creditsPurchased: Number(creditsPurchased),
      packageName,
      amountPaid: Number(amountPaid),
      transactionId,
      paymentMethod: paymentMethod || 'card',
      paymentDate: new Date().toISOString(),
      status: 'succeeded' as const,
    };

    // Insert payment record
    await db.collection('payments').insertOne(paymentDoc);

    // Atomically increment user credits
    await db.collection('user').updateOne(
      { email: userEmail },
      { $inc: { credits: Number(creditsPurchased) } }
    );

    res.status(201).json({
      success: true,
      message: 'Payment recorded and credits added',
      data: paymentDoc,
    });
  } catch (error: unknown) {
    console.error('Error saving payment:', error);
    const message = error instanceof Error ? error.message : 'Failed to save payment';
    res.status(500).json({ success: false, message });
  }
});

// GET /api/payments/:email — Fetch payment history for a user
app.get('/api/payments/:email', async (req: Request, res: Response) => {
  try {
    const email = req.params.email as string;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email parameter is required',
      });
    }

    const payments = await db
      .collection('payments')
      .find({ userEmail: email })
      .sort({ paymentDate: -1 })
      .toArray();

    res.json({ success: true, data: payments });
  } catch (error: unknown) {
    console.error('Error fetching payments:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch payments';
    res.status(500).json({ success: false, message });
  }
});


// ── USER LOOKUP ──────────────────────────────────────────────

// GET /api/users/:email — Fetch user by email (credits, role, name)
app.get('/api/users/:email', async (req: Request, res: Response) => {
  try {
    const email = req.params.email as string;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await db.collection<any>('user').findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        name: user.name,
        email: user.email,
        role: user.role || 'supporter',
        credits: user.credits || 0,
        image: user.image || null,
      },
    });
  } catch (error: unknown) {
    console.error('Error fetching user:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch user';
    res.status(500).json({ success: false, message });
  }
});


// ── CONTRIBUTION ENDPOINTS ───────────────────────────────────

// POST /api/contributions — Create a new contribution (Pending)
app.post('/api/contributions', async (req: Request, res: Response) => {
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
        message: 'Missing required fields: campaignId, supporterEmail, amount',
      });
    }

    const contributionAmount = Number(amount);
    if (isNaN(contributionAmount) || contributionAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Contribution amount must be a positive number',
      });
    }

    // ── Validate user exists and is a supporter ──
    const user = await db.collection<any>('user').findOne({ email: supporterEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if ((user.role || 'supporter') !== 'supporter') {
      return res.status(403).json({
        success: false,
        message: 'Only Supporters can contribute to campaigns',
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
      return res.status(400).json({ success: false, message: 'Invalid campaign ID' });
    }

    const campaign = await db.collection('campaigns').findOne({ _id: new ObjectId(campaignId) });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    if (campaign.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'This campaign is not currently accepting contributions',
      });
    }

    // ── Validate campaign hasn't expired ──
    const deadline = new Date(campaign.deadline);
    if (deadline.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'This campaign has ended',
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
      supporterName: supporterName || user.name || 'Anonymous',
      creatorEmail: creatorEmail || campaign.creator_email,
      amount: contributionAmount,
      message: message || '',
      status: 'Pending',
      createdAt: new Date().toISOString(),
    };

    await db.collection('contributions').insertOne(contributionDoc);

    // ── Deduct credits from supporter ──
    await db.collection('user').updateOne(
      { email: supporterEmail },
      { $inc: { credits: -contributionAmount } }
    );

    // Do NOT increase campaign raisedCredits or backers here.
    // That only happens when the Creator approves the contribution.

    res.status(201).json({
      success: true,
      message: 'Contribution submitted successfully! Awaiting creator approval.',
      data: contributionDoc,
    });
  } catch (error: unknown) {
    console.error('Error creating contribution:', error);
    const message = error instanceof Error ? error.message : 'Failed to create contribution';
    res.status(500).json({ success: false, message });
  }
});

// GET /api/contributions/creator/:email — Fetch all contributions for a creator's campaigns
app.get('/api/contributions/creator/:email', async (req: Request, res: Response) => {
  try {
    const creatorEmail = req.params.email as string;

    if (!creatorEmail) {
      return res.status(400).json({ success: false, message: 'Creator email is required' });
    }

    const contributions = await db
      .collection('contributions')
      .find({ creatorEmail })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ success: true, data: contributions });
  } catch (error: unknown) {
    console.error('Error fetching creator contributions:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch contributions';
    res.status(500).json({ success: false, message });
  }
});

// PATCH /api/contributions/:id/status — Approve or reject a contribution
app.patch('/api/contributions/:id/status', async (req: Request, res: Response) => {
  try {
    const contributionId = req.params.id as string;
    const { status } = req.body;

    if (!ObjectId.isValid(contributionId)) {
      return res.status(400).json({ success: false, message: 'Invalid contribution ID' });
    }

    if (!['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be "Approved" or "Rejected"',
      });
    }

    // Find the contribution
    const contribution = await db.collection<any>('contributions').findOne({
      _id: new ObjectId(contributionId),
    });

    if (!contribution) {
      return res.status(404).json({ success: false, message: 'Contribution not found' });
    }

    if (contribution.status !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: `This contribution is already ${contribution.status}`,
      });
    }

    // Update contribution status
    await db.collection('contributions').updateOne(
      { _id: new ObjectId(contributionId) },
      { $set: { status, updatedAt: new Date().toISOString() } }
    );

    if (status === 'Approved') {
      // ── Increase campaign raisedCredits ──
      await db.collection('campaigns').updateOne(
        { _id: new ObjectId(contribution.campaignId) },
        { $inc: { raisedCredits: contribution.amount } }
      );

      // ── Increase backers by 1 only if this is the first approved contribution from this supporter ──
      const previousApproved = await db.collection('contributions').countDocuments({
        campaignId: contribution.campaignId,
        supporterEmail: contribution.supporterEmail,
        status: 'Approved',
        _id: { $ne: new ObjectId(contributionId) },
      });

      if (previousApproved === 0) {
        await db.collection('campaigns').updateOne(
          { _id: new ObjectId(contribution.campaignId) },
          { $inc: { backers: 1 } }
        );
      }

      // Send notification to supporter
      await db.collection('notifications').insertOne({
        user_email: contribution.supporterEmail,
        title: 'Contribution Approved!',
        message: `Your contribution of ${contribution.amount} Cr to "${contribution.campaignTitle}" has been approved by the creator.`,
        type: 'contribution_approved',
        read: false,
        createdAt: new Date().toISOString(),
      });
    } else if (status === 'Rejected') {
      // ── Refund credits to supporter ──
      await db.collection('user').updateOne(
        { email: contribution.supporterEmail },
        { $inc: { credits: contribution.amount } }
      );

      // Send notification to supporter
      await db.collection('notifications').insertOne({
        user_email: contribution.supporterEmail,
        title: 'Contribution Rejected',
        message: `Your contribution of ${contribution.amount} Cr to "${contribution.campaignTitle}" has been rejected. Credits have been refunded to your account.`,
        type: 'contribution_rejected',
        read: false,
        createdAt: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: `Contribution ${status.toLowerCase()} successfully`,
    });
  } catch (error: unknown) {
    console.error('Error updating contribution status:', error);
    const message = error instanceof Error ? error.message : 'Failed to update contribution status';
    res.status(500).json({ success: false, message });
  }
});


const client = new MongoClient(process.env.MONGO_URI!);
export const db = client.db("fundforge");

export async function connectToMongoDB() {
  try {
    await client.connect();
    await db.command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

// Call this only when your application terminates
export async function disconnectFromMongoDB() {
  await client.close();
}

connectToMongoDB().then(() => {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}).catch(console.dir);
