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
