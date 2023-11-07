const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 5000;
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_SECRET_KEY);

// middleware
app.use(cors());
app.use(express.json());

// jwt token verification middleware
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }

  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET_TOKEN, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }

    req.decoded = decoded;
    next();
  });
};

// mongo db
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { JsonWebTokenError } = require("jsonwebtoken");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.5732rtt.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const userCollection = client.db("bistroRestaurantDB").collection("users");
    const menuCollection = client.db("bistroRestaurantDB").collection("menu");
    const reviewCollection = client
      .db("bistroRestaurantDB")
      .collection("reviews");
    const cartCollection = client.db("bistroRestaurantDB").collection("cart");
    const paymentCollection = client
      .db("bistroRestaurantDB")
      .collection("payments");

    // verifyAdmin middleware
    const verifyAdmin = async (req, res, next) => {
      const userEmail = req.decoded?.email;
      const user = await userCollection.findOne({ email: userEmail });

      if (user?.role !== "admin") {
        return res
          .status(401)
          .send({ error: true, message: "forbidden access" });
      }

      next();
    };

    // jwt api
    app.post("/jwt", (req, res) => {
      const userEmail = req.body;
      const token = jwt.sign(userEmail, process.env.JWT_SECRET_TOKEN, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // menu related api
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    app.post("/menu", verifyJWT, verifyAdmin, async (req, res) => {
      const newItem = req.body;
      const result = await menuCollection.insertOne(newItem);
      res.send(result);
    });

    app.delete("/menu/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const result = await menuCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // review related api
    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    // cart related api
    app.get("/cart", verifyJWT, async (req, res) => {
      const email = req.query.email;

      if (!email || email === undefined) {
        return res.send([]);
      }

      if (req.decoded?.email !== email) {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }

      const result = await cartCollection.find({ email: email }).toArray();
      res.send(result);
    });

    app.post("/cart", async (req, res) => {
      const item = req.body;
      const result = await cartCollection.insertOne(item);
      res.send(result);
    });

    app.delete("/cart/:id", async (req, res) => {
      const id = req.params.id;
      const result = await cartCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // user related api
    // security layers for admin apis
    // 0. hide admin routes only to admin and user routes to users using isAdmin ?
    // 1. verifyJWT : so that api link is not open to everyone
    // 2. use verifyAdmin(after verifyJWT) in all admin routes: to chk if the user is genuinely an Admin or not, to prevent going to the admin routes using browser url bar
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await userCollection.find({}).toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;

      // query to check if user already exists
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "user already exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // api to check if user is an Admin
    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const userEmail = req.params.email;
      const user = await userCollection.findOne({ email: userEmail });
      console.log(req.decoded);

      if (req.decoded.email !== userEmail) {
        return res.send({ isAdmin: false });
      }

      res.send({ isAdmin: user?.role === "admin" });
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const filter = { _id: new ObjectId(id) };

      const updatedUser = {
        $set: {
          role: "admin",
        },
      };

      const result = await userCollection.updateOne(filter, updatedUser);
      res.send(result);
    });

    // PAYMENT RELATED API
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const price = req.body.totalPrice;
      const amount = price * 100; // to convert price into cent(poisa)

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", verifyJWT, async (req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Bistro Boss Server is up and running");
});

app.listen(port, () => {
  console.log("server is running on port: ", port);
});
