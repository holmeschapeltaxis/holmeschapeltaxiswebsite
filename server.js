const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const app = express();
const port = 3000;

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

// Serve static files from the same folder as server.js
app.use(express.static(__dirname)); 

const mongoURI = "mongodb+srv://admin:admin123@cluster0.do482.mongodb.net/test";
mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch((err) => console.error('Error connecting to MongoDB', err));

const ultraMsgApiUrl = 'https://api.ultramsg.com/instance95302/messages/chat';
const ultraMsgToken = '3i8w51jg2yhlasfm';

// Define the schema for bookings
const bookingSchema = new mongoose.Schema({
    fullName: String,
    email: String,
    passengers: Number,
    from: String,
    destination: String,
    phone: String,
    date: String,
    time: String,
    accepted: { type: Boolean, default: false },
    driverPhone: String,
    rejectedBy: [String] // Add this field to store rejected driver usernames
});


const Booking = mongoose.model('Booking', bookingSchema);

// Define the schema for drivers
const driverSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }, // Storing plain text password for now
    phone: String,
    email: String
});

const Driver = mongoose.model('Driver', driverSchema);

// Function to send WhatsApp messages
async function sendWhatsAppMessage(to, message) {
    try {
        await axios.post(ultraMsgApiUrl, {
            token: ultraMsgToken,
            to,
            body: message
        });
        console.log(`Message sent to ${to}`);
    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
    }
}

// Route to serve the home page
app.get("/", function(req, res) {
    res.sendFile(__dirname + "/index.html");
});

// Route to handle new bookings
app.post("/", function(req, res) {
    let newBook = new Booking({
        fullName: req.body.fullName,
        email: req.body.email,
        passengers: req.body.passengers,
        from: req.body.from,
        destination: req.body.destination,
        phone: req.body.phone,
        date: req.body.date,
        time: req.body.time
    });

    newBook.save()
        .then(() => res.redirect("/"))
        .catch((err) => {
            console.error('Error saving booking:', err);
            res.status(500).send('Error saving booking');
        });
});

// Route to serve the driver page
app.get('/driver', function(req, res) {
    res.sendFile(__dirname + "/driver.html");
});

// Route to get all bookings that are not accepted
app.get('/api/bookings', async (req, res) => {
    try {
        const bookings = await Booking.find({ accepted: false }); // Only fetch unaccepted bookings
        res.json(bookings);
    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).send('Error fetching bookings');
    }
});

// Route to handle booking acceptance and driver assignment
app.post('/api/accept/:id', async (req, res) => {
    try {
        const bookingId = req.params.id;
        const { driverUsername } = req.body;

        // Find the booking
        const booking = await Booking.findById(bookingId);
        if (!booking) {
            console.error('Booking not found:', bookingId);
            return res.status(404).send('Booking not found');
        }

        // Find the driver by username
        const driver = await Driver.findOne({ username: driverUsername });
        if (!driver) {
            console.error('Driver not found for username:', driverUsername);
            return res.status(400).send('Driver not found');
        }

        // Update the booking with the driver's phone number and mark as accepted
        booking.driverPhone = driver.phone;
        booking.accepted = true;
        await booking.save();

        // Prepare messages
        // const customerMessage = `Hello ${booking.fullName}, your booking from ${booking.from} to ${booking.destination} on ${booking.date} at ${booking.time} has been accepted. The driver's contact is ${driver.phone}.`;
        // const driverMessage = `Hello ${driver.username}, you have a new booking from ${booking.from} to ${booking.destination} on ${booking.date} at ${booking.time}. The customer's name is ${booking.fullName}, and their contact is ${booking.phone}.`;

        const driverMessage = `Hello ${driver.username}, you have a new booking!
Customer Name: ${booking.fullName}
Date : ${booking.date}
Time : ${booking.time}
Pick up : ${booking.from}
Destination : ${booking.destination}
Customer Phone : ${booking.phone}`;

        const customerMessage = `Hello ${booking.fullName}, your booking has been accepted!
Date : ${booking.date}
Time : ${booking.time}
Pick up : ${booking.from}
Destination : ${booking.destination}
Driver Phone : ${driver.phone}`;



        // Send WhatsApp messages
        await sendWhatsAppMessage(booking.phone, customerMessage);
        await sendWhatsAppMessage(driver.phone, driverMessage);

        res.status(200).send('Booking accepted and messages sent');
    } catch (error) {
        console.error('Error accepting booking:', error);
        res.status(500).send('Error accepting booking');
    }
});

// Driver signup route
app.post('/driver/signup', async (req, res) => {
    const { username, password, phone, email } = req.body;

    try {
        // Check if the username already exists
        const existingDriver = await Driver.findOne({ username });
        if (existingDriver) {
            return res.status(400).json({ message: 'Username already taken' });
        }

        // Create a new driver with plain text password
        const newDriver = new Driver({
            username,
            password, // No hashing, storing plain text password
            phone,
            email
        });

        // Save the driver in the database
        await newDriver.save();
        res.status(201).json({ message: 'Driver registered successfully' });

    } catch (err) {
        console.error('Error during driver signup', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Driver login route
app.post('/driver/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // Find the driver by username
        const driver = await Driver.findOne({ username });
        if (!driver) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }

        // Check if the password matches
        if (driver.password !== password) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }

        // Successful login
        res.status(200).json({ message: 'Login successful', redirect: '/driver', driverPhone: driver.phone, username: driver.username });

    } catch (err) {
        console.error('Error during driver login', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Route to handle booking rejection (driver-specific UI update)
app.post('/api/reject/:id', async (req, res) => {
    try {
        const bookingId = req.params.id;
        const { driverUsername } = req.body;

        // Find the booking
        const booking = await Booking.findById(bookingId);
        if (!booking) {
            console.error('Booking not found:', bookingId);
            return res.status(404).send('Booking not found');
        }

        // Add the driver to the rejectedBy array if not already present
        if (!booking.rejectedBy.includes(driverUsername)) {
            booking.rejectedBy.push(driverUsername);
            await booking.save();
        }

        res.status(200).send('Booking rejected');
    } catch (error) {
        console.error('Error rejecting booking:', error);
        res.status(500).send('Error rejecting booking');
    }
});



// app.get('/api/bookings/:driverUsername', async (req, res) => {
//     const driverUsername = req.params.driverUsername;
    
//     try {
//         // Find the driver by username
//         const driver = await Driver.findOne({ username: driverUsername });

//         // Fetch bookings that are either not accepted and not rejected by this driver, 
//         // or accepted by this driver
//         const bookings = await Booking.find({
//             $or: [
//                 { accepted: false, rejectedBy: { $ne: driverUsername } }, // Only show unaccepted bookings not rejected by this driver
//                 { driverPhone: driver.phone } // Also show bookings accepted by this driver
//             ]
//         });
        
//         res.json(bookings);
//     } catch (error) {
//         console.error('Error fetching bookings:', error);
//         res.status(500).send('Error fetching bookings');
//     }
// });

app.get('/api/bookings/:driverUsername', async (req, res) => {
    const driverUsername = req.params.driverUsername;
    
    try {
        // Find the driver by username
        const driver = await Driver.findOne({ username: driverUsername });

        // Fetch only unaccepted bookings that are not rejected by this driver, limited to 5
        const bookings = await Booking.find({
            accepted: false,
            rejectedBy: { $ne: driverUsername }
        })
        .limit(5);  // Limit the number of bookings shown to 5
        
        res.json(bookings);
    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).send('Error fetching bookings');
    }
});



// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
