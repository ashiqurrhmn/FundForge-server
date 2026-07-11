import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

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
