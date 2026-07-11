import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config();

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
    const campaignId = req.params.id;
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
    const campaignId = req.params.id;
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
    const creatorId = req.params.id;
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
    const campaignId = req.params.id;
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
    const campaignId = req.params.id;
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
    const users = await db.collection("user").find().sort({ createdAt: -1 }).toArray();
    res.json({ success: true, data: users });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Update user role
app.patch('/api/users/admin/:id/role', async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;
    const { role } = req.body;

    if (!["admin", "creator", "supporter"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }

    const user = await db.collection("user").findOneAndUpdate(
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
    const userId = req.params.id;

    const user = await db.collection("user").findOne({ _id: userId });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await db.collection("user").deleteOne({ _id: userId });
    
    // Clean up related auth data
    await db.collection("session").deleteMany({ userId: userId });
    await db.collection("account").deleteMany({ userId: userId });

    res.json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
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
