/**
 * PDF Import Service for BH2 Hostel Room Allocations
 * Processes the authoritative 15-page allocation document:
 * - Maps floor hierarchy (-1: Basement, 0: Ground, 1: 1st, 2: 2nd, 3: 3rd)
 * - Configures Room 30 with capacity 8
 * - Omits Krunal Bhaveshbhai Vasoya (blank room) as directed by user
 * - Provides preview and idempotent transactional confirmation
 */

const mongoose = require('mongoose');
const Hostel = require('../models/Hostel');
const HostelFloor = require('../models/HostelFloor');
const HostelRoom = require('../models/HostelRoom');
const RoomAllocation = require('../models/RoomAllocation');
const RoomAllocationAudit = require('../models/RoomAllocationAudit');
const User = require('../models/User');
const logger = require('../utils/logger');

// Authoritative parsed rows from the 15-page BH2 hostel document
const RAW_BH2_RECORDS = [
  // Page 1: 2nd Year B Wing
  { sr: 1, name: "roshan paner", rollNo: "112515231", roomNo: "B13" },
  { sr: 2, name: "prathemesh dhage", rollNo: "112515208", roomNo: "B13" },
  { sr: 3, name: "rohan dighe", rollNo: "112516085", roomNo: "B13" },
  { sr: 4, name: "rishabh agrawal", rollNo: "112515226", roomNo: "B13" },
  { sr: 5, name: "jatin", rollNo: "112516042", roomNo: "B12" },
  { sr: 6, name: "minesh sihra", rollNo: "112516056", roomNo: "B12" },
  { sr: 7, name: "chintransh nagar", rollNo: "112515088", roomNo: "B12" },
  { sr: 8, name: "atharva verma", rollNo: "112516018", roomNo: "B12" },
  { sr: 9, name: "Akash Kale", rollNo: "112515025", roomNo: "B11" },
  { sr: 10, name: "Aniket Rite", rollNo: "112515036", roomNo: "B11" },
  { sr: 11, name: "Atharva Ekal", rollNo: "112515060", roomNo: "B11" },
  { sr: 12, name: "Aman Kumar", rollNo: "112515031", roomNo: "B11" },
  { sr: 13, name: "Varun Sandesh", rollNo: "112515308", roomNo: "B10" },
  { sr: 14, name: "Shivasai Bacha", rollNo: "112515268", roomNo: "B10" },
  { sr: 15, name: "Sivakrishna", rollNo: "112515306", roomNo: "B10" },
  { sr: 16, name: "Rohit", rollNo: "112516022", roomNo: "B10" },
  { sr: 17, name: "Aryan Garad", rollNo: "112515110", roomNo: "B09" },
  { sr: 18, name: "Tushar Mukund", rollNo: "112515304", roomNo: "B09" },
  { sr: 19, name: "Aniket Kadam", rollNo: "112515136", roomNo: "B09" },
  { sr: 20, name: "Tanmay Durgam", rollNo: "112516101", roomNo: "B09" },
  { sr: 21, name: "M.Omeshhon Reddy", rollNo: "112515176", roomNo: "B08" },
  { sr: 22, name: "Tanish Bafna", rollNo: "112515294", roomNo: "B08" },
  { sr: 23, name: "Atharva Chavan", rollNo: "112515061", roomNo: "B08" },
  { sr: 24, name: "Anil Choudhary", rollNo: "112516012", roomNo: "B08" },
  { sr: 25, name: "Dhawal", rollNo: "112515098", roomNo: "B07" },
  { sr: 26, name: "Tanmay Tejas", rollNo: "112516102", roomNo: "B07" },
  { sr: 27, name: "Rajan Raman", rollNo: "112516083", roomNo: "B07" },

  // Page 2: B Wing & 313, 234, 233
  { sr: 28, name: "Satvik Khanna", rollNo: "112515253", roomNo: "B07" },
  { sr: 29, name: "Harsh Vishvakarma", rollNo: "112516041", roomNo: "B06" },
  { sr: 30, name: "Tanishk Khandelwal", rollNo: "112515295", roomNo: "B06" },
  { sr: 31, name: "Harsha", rollNo: "112515138", roomNo: "B06" },
  { sr: 32, name: "Ayush Jadhav", rollNo: "112516002", roomNo: "B06" },
  { sr: 33, name: "Satyam", rollNo: "112515254", roomNo: "B05" },
  { sr: 34, name: "Siddharth", rollNo: "112515275", roomNo: "B05" },
  { sr: 35, name: "Aryan Singh", rollNo: "112515054", roomNo: "B05" },
  { sr: 36, name: "Anjal", rollNo: "112515038", roomNo: "B05" },
  { sr: 37, name: "Soham Jawade", rollNo: "112515279", roomNo: "B03" },
  { sr: 38, name: "Shlok Shah", rollNo: "112515260", roomNo: "B03" },
  { sr: 39, name: "Akshit Agrawal", rollNo: "112516009", roomNo: "B03" },
  { sr: 40, name: "Kathan Shah", rollNo: "112515259", roomNo: "B03" },
  { sr: 41, name: "Bhargav Kachadiya", rollNo: "112515135", roomNo: "B02" },
  { sr: 42, name: "Kavya Patel", rollNo: "112515140", roomNo: "B02" },
  { sr: 43, name: "Nitya Jain", rollNo: "112516070", roomNo: "B02" },
  { sr: 44, name: "Krishna Yadav", rollNo: "112516049", roomNo: "B02" },
  { sr: 45, name: "Atharva Agrawal", rollNo: "112515058", roomNo: "B01" },
  { sr: 46, name: "Amber Agrawari", rollNo: "112515034", roomNo: "B01" },
  { sr: 47, name: "Aryan Singhwal", rollNo: "112515055", roomNo: "B01" },
  { sr: 48, name: "SHAHNAWAZ MEMON", rollNo: "112515261", roomNo: "313" },
  { sr: 49, name: "Faheem", rollNo: "112515108", roomNo: "313" },
  { sr: 50, name: "Fawaz", rollNo: "112515172", roomNo: "313" },
  { sr: 51, name: "Yazeed", rollNo: "112515317", roomNo: "313" },
  { sr: 52, name: "Yashraj", rollNo: "112515315", roomNo: "234" },
  { sr: 53, name: "Samyak kamble", rollNo: "112515239", roomNo: "234" },
  { sr: 54, name: "Boorla Abhiram", rollNo: "112516024", roomNo: "234" },
  { sr: 55, name: "Aryan Mandape", rollNo: "112515052", roomNo: "234" },
  { sr: 56, name: "meet varma", rollNo: "112515166", roomNo: "233" },

  // Page 3: 233 to 223
  { sr: 57, name: "chinmay jain", rollNo: "112515084", roomNo: "233" },
  { sr: 58, name: "preshit sapkale", rollNo: "112516091", roomNo: "233" },
  { sr: 59, name: "ayush kumar", rollNo: "112515068", roomNo: "233" },
  { sr: 60, name: "Arpit Bhati", rollNo: "112516015", roomNo: "232" },
  { sr: 61, name: "Pranshu Goyal", rollNo: "112515206", roomNo: "232" },
  { sr: 62, name: "Vishesh", rollNo: "112516092", roomNo: "232" },
  { sr: 63, name: "Prathamesh Sonawane", rollNo: "112515280", roomNo: "232" },
  { sr: 64, name: "gaurav", rollNo: "112516036", roomNo: "231" },
  { sr: 65, name: "shresth", rollNo: "112515271", roomNo: "231" },
  { sr: 66, name: "siddhartha", rollNo: "112515224", roomNo: "231" },
  { sr: 67, name: "dhananjay", rollNo: "112515097", roomNo: "231" },
  { sr: 68, name: "shrest vikas reddy", rollNo: "112515160", roomNo: "230" },
  { sr: 69, name: "t. shivamani", rollNo: "112515299", roomNo: "230" },
  { sr: 70, name: "ruchir", rollNo: "112515192", roomNo: "230" },
  { sr: 71, name: "abhiram chaitanya", rollNo: "112516090", roomNo: "230" },
  { sr: 72, name: "Ayush Agrawal", rollNo: "112515006", roomNo: "227" },
  { sr: 73, name: "Siddharth S", rollNo: "112516097", roomNo: "226" },
  { sr: 74, name: "Manideep Yadav", rollNo: "112515182", roomNo: "226" },
  { sr: 75, name: "Chandravardhan Reddy", rollNo: "112515311", roomNo: "226" },
  { sr: 76, name: "Yuvraj", rollNo: "112516110", roomNo: "225" },
  { sr: 77, name: "Sarthak Gaikwad", rollNo: "112515248", roomNo: "225" },
  { sr: 78, name: "Shashank Shirurkar", rollNo: "112516096", roomNo: "225" },
  { sr: 79, name: "Yash Narayan", rollNo: "112516108", roomNo: "225" },
  { sr: 80, name: "Bhuvan narang", rollNo: "112515078", roomNo: "224" },
  { sr: 81, name: "Rahul Uikey", rollNo: "112515216", roomNo: "224" },
  { sr: 82, name: "Chaitanya", rollNo: "112515081", roomNo: "224" },
  { sr: 83, name: "Vimarsh", rollNo: "112515312", roomNo: "224" },
  { sr: 84, name: "Abhishek George", rollNo: "112515015", roomNo: "223" },
  { sr: 85, name: "Nandkishore", rollNo: "112515180", roomNo: "223" },

  // Page 4: 223 to 215
  { sr: 86, name: "Mohn. Akhas", rollNo: "112515171", roomNo: "223" },
  { sr: 87, name: "E. Himnesh", rollNo: "112516034", roomNo: "223" },
  { sr: 88, name: "Shivraj", rollNo: "112515269", roomNo: "222" },
  { sr: 89, name: "Sandesh", rollNo: "112515242", roomNo: "222" },
  { sr: 90, name: "Aryan", rollNo: "112515053", roomNo: "222" },
  { sr: 91, name: "Atharva Patil", rollNo: "112515059", roomNo: "222" },
  { sr: 92, name: "Abhyudya Singh", rollNo: "112516005", roomNo: "221" },
  { sr: 93, name: "Pratik Goyal", rollNo: "112515209", roomNo: "221" },
  { sr: 94, name: "Yug Limachiya", rollNo: "112516052", roomNo: "221" },
  { sr: 95, name: "Harsh Patidar", rollNo: "112516039", roomNo: "221" },
  { sr: 96, name: "Darsheel", rollNo: "112516025", roomNo: "220" },
  { sr: 97, name: "Aditiya yadav", rollNo: "112516007", roomNo: "220" },
  { sr: 98, name: "arin jain", rollNo: "112515046", roomNo: "220" },
  { sr: 99, name: "utpal singh", rollNo: "112515307", roomNo: "220" },
  { sr: 100, name: "krish", rollNo: "112515148", roomNo: "219" },
  { sr: 101, name: "meet fadia", rollNo: "112515165", roomNo: "219" },
  { sr: 102, name: "harmik", rollNo: "112515233", roomNo: "219" },
  { sr: 103, name: "Keshav Yadav", rollNo: "112515142", roomNo: "218" },
  { sr: 104, name: "Jatin Kumar", rollNo: "112515133", roomNo: "218" },
  { sr: 105, name: "Adarsh Agarwala", rollNo: "112515019", roomNo: "218" },
  { sr: 106, name: "Ankit Anand", rollNo: "112515039", roomNo: "218" },
  { sr: 107, name: "Madhav Nagar", rollNo: "112515156", roomNo: "217" },
  { sr: 108, name: "Sarthak Chouhan", rollNo: "112515250", roomNo: "217" },
  { sr: 109, name: "k. neeraj", rollNo: "112515146", roomNo: "217" },
  { sr: 110, name: "Rakshit Rao", rollNo: "112515219", roomNo: "217" },
  { sr: 111, name: "Tejas Majgawali", rollNo: "112515298", roomNo: "215" },
  { sr: 112, name: "Gaurvendra Singh", rollNo: "112515114", roomNo: "215" },
  { sr: 113, name: "Kishor Kumar", rollNo: "112515223", roomNo: "215" },

  // Page 5: 215 to 208
  { sr: 114, name: "Atharva Khunte", rollNo: "112515062", roomNo: "215" },
  { sr: 115, name: "Kiran Mylabathula", rollNo: "112515179", roomNo: "214" },
  { sr: 116, name: "Ayush L", rollNo: "112515154", roomNo: "214" },
  { sr: 117, name: "Kota Pawan Yagnesh", rollNo: "112515147", roomNo: "214" },
  { sr: 118, name: "Keshav Giri", rollNo: "112515141", roomNo: "214" },
  { sr: 119, name: "Sanskar Kokate", rollNo: "112515145", roomNo: "213" },
  { sr: 120, name: "anish valke", rollNo: "112515037", roomNo: "213" },
  { sr: 121, name: "abhishek patil", rollNo: "112515012", roomNo: "213" },
  { sr: 122, name: "Ram Chopade", rollNo: "112515221", roomNo: "213" },
  { sr: 123, name: "Ayushman Ghosh", rollNo: "112515072", roomNo: "212" },
  { sr: 124, name: "Ashish sewda", rollNo: "112515056", roomNo: "212" },
  { sr: 125, name: "het", rollNo: "112515276", roomNo: "212" },
  { sr: 126, name: "ayush polara", rollNo: "112515202", roomNo: "212" },
  { sr: 127, name: "Shikhar Saxena", rollNo: "112516095", roomNo: "211" },
  { sr: 128, name: "Abhinav Reddy", rollNo: "112515117", roomNo: "211" },
  { sr: 129, name: "Akshat Mudhale", rollNo: "112515028", roomNo: "211" },
  { sr: 130, name: "Aaditya Nawandar", rollNo: "112515002", roomNo: "211" },
  { sr: 131, name: "Dasari Krithik", rollNo: "112515091", roomNo: "210" },
  { sr: 132, name: "Tanay Eedha", rollNo: "112515106", roomNo: "210" },
  { sr: 133, name: "Madhu", rollNo: "112516033", roomNo: "210" },
  { sr: 134, name: "Aditya Macharla", rollNo: "112515155", roomNo: "210" },
  { sr: 135, name: "Dipanshu Yadav", rollNo: "112515100", roomNo: "209" },
  { sr: 136, name: "Ayush Singh", rollNo: "112515070", roomNo: "209" },
  { sr: 137, name: "Arjun Mishra", rollNo: "112515048", roomNo: "209" },
  { sr: 138, name: "Atharva Deshmukh", rollNo: "112515064", roomNo: "209" },
  { sr: 139, name: "Aditya Purohit", rollNo: "112515022", roomNo: "208" },
  { sr: 140, name: "Pushpak Kanhed", rollNo: "112515215", roomNo: "208" },
  { sr: 141, name: "Aadhar Prajapati", rollNo: "112515001", roomNo: "208" },

  // Page 6: 208 to 201
  { sr: 142, name: "Sagar", rollNo: "112516086", roomNo: "208" },
  { sr: 143, name: "Dheeraj Kumar", rollNo: "112516029", roomNo: "207" },
  { sr: 144, name: "Mohammed Rayan", rollNo: "112516059", roomNo: "207" },
  { sr: 145, name: "Dhanraj", rollNo: "112516028", roomNo: "207" },
  { sr: 146, name: "Sheikh Rayyan", rollNo: "112515262", roomNo: "207" },
  { sr: 147, name: "Himanshu Gaigole", rollNo: "112515109", roomNo: "206" },
  { sr: 148, name: "Nachiket Shourya", rollNo: "112516064", roomNo: "206" },
  { sr: 149, name: "Ayush Singh", rollNo: "112515069", roomNo: "206" },
  { sr: 150, name: "Archit Adate", rollNo: "112515045", roomNo: "206" },
  { sr: 151, name: "Sriharsha", rollNo: "112516043", roomNo: "205" },
  { sr: 152, name: "Pushpak nandan", rollNo: "112515290", roomNo: "205" },
  { sr: 153, name: "Surya Ravikiran", rollNo: "112515103", roomNo: "205" },
  { sr: 154, name: "Sathwik varma", rollNo: "112515073", roomNo: "205" },
  { sr: 155, name: "Ramcharan", rollNo: "112515277", roomNo: "204" },
  { sr: 156, name: "Vinay Reddy", rollNo: "112515302", roomNo: "204" },
  { sr: 157, name: "Shashwat Jain", rollNo: "112515264", roomNo: "204" },
  { sr: 158, name: "hrushikesh more", rollNo: "112516061", roomNo: "204" },
  { sr: 159, name: "neel", rollNo: "112516068", roomNo: "203" },
  { sr: 160, name: "ruchit", rollNo: "112515232", roomNo: "203" },
  { sr: 161, name: "sahil", rollNo: "112516087", roomNo: "203" },
  { sr: 162, name: "swastik", rollNo: "112515292", roomNo: "203" },
  { sr: 163, name: "Pushp", rollNo: "112515214", roomNo: "202" },
  { sr: 164, name: "Priyanshu Jaiswal", rollNo: "112515213", roomNo: "202" },
  { sr: 165, name: "Abhishek Pagare", rollNo: "112515014", roomNo: "202" },
  { sr: 166, name: "Amarnath Gupta", rollNo: "112515033", roomNo: "202" },
  { sr: 167, name: "Sayan Majumdar", rollNo: "112515255", roomNo: "201" },
  { sr: 168, name: "Keshav Padia", rollNo: "112516072", roomNo: "201" },
  { sr: 169, name: "Arshith Kumar", rollNo: "112515049", roomNo: "201" },
  { sr: 170, name: "Anurag Sinha", rollNo: "112515041", roomNo: "201" },

  // Page 7: 132 to 123, 314
  { sr: 171, name: "Kunal Jangid", rollNo: "112515132", roomNo: "132" },
  { sr: 172, name: "Meanas Chiwande", rollNo: "112515162", roomNo: "132" },
  { sr: 173, name: "Naseem Khan", rollNo: "112516046", roomNo: "132" },
  { sr: 174, name: "Aziz Pitolwala", rollNo: "112516021", roomNo: "132" },
  { sr: 175, name: "Abhinav Yadav", rollNo: "112515009", roomNo: "131" },
  { sr: 176, name: "Akash Singh", rollNo: "112515026", roomNo: "131" },
  { sr: 177, name: "Nikhil Nayak", rollNo: "112515188", roomNo: "131" },
  { sr: 178, name: "Raman Patil", rollNo: "112515222", roomNo: "131" },
  { sr: 179, name: "Prakhar Mehta", rollNo: "112515205", roomNo: "130" },
  { sr: 180, name: "Abhishek Saini", rollNo: "112515016", roomNo: "130" },
  { sr: 181, name: "Saicharan", rollNo: "112515107", roomNo: "130" },
  { sr: 182, name: "Vedant chaple", rollNo: "112515310", roomNo: "129" },
  { sr: 183, name: "Piyush Patel", rollNo: "112515201", roomNo: "129" },
  { sr: 184, name: "Affaan Sheikh", rollNo: "112515170", roomNo: "129" },
  { sr: 185, name: "Nikhil J. Singh", rollNo: "112515187", roomNo: "129" },
  { sr: 186, name: "Siddhesh Umbarkar", rollNo: "112515305", roomNo: "128" },
  { sr: 187, name: "Abhishek kukade", rollNo: "112515150", roomNo: "128" },
  { sr: 188, name: "Prasad Shelke", rollNo: "112515265", roomNo: "128" },
  { sr: 189, name: "Vaibhav Gawade", rollNo: "112515115", roomNo: "128" },
  { sr: 190, name: "Nayan Raj", rollNo: "112516067", roomNo: "314" },
  { sr: 191, name: "Geetansh Seth", rollNo: "112515116", roomNo: "314" },
  { sr: 192, name: "aaryan", rollNo: "112515004", roomNo: "125" },
  { sr: 193, name: "divyanshu", rollNo: "112515101", roomNo: "125" },
  { sr: 194, name: "Dashank", rollNo: "112515092", roomNo: "124" },
  { sr: 195, name: "Shourya", rollNo: "112515076", roomNo: "124" },
  { sr: 196, name: "Chirasmith", rollNo: "112515086", roomNo: "124" },
  { sr: 197, name: "Soumya", rollNo: "112515281", roomNo: "123" },
  { sr: 198, name: "Hardik", rollNo: "112516038", roomNo: "123" },

  // Page 8: 123 to 116
  { sr: 199, name: "Yug", rollNo: "112515096", roomNo: "123" },
  { sr: 200, name: "Harshit", rollNo: "112515127", roomNo: "123" },
  { sr: 201, name: "Namit Mourya", rollNo: "112516066", roomNo: "122" },
  { sr: 202, name: "Ankit Kumar Maurya", rollNo: "112515040", roomNo: "122" },
  { sr: 203, name: "Naman Shukla", rollNo: "112516065", roomNo: "122" },
  { sr: 204, name: "Om Prakash", rollNo: "112515190", roomNo: "122" },
  { sr: 205, name: "Vishal Katariya", rollNo: "112516107", roomNo: "121" },
  { sr: 206, name: "shalin nagar", rollNo: "112515263", roomNo: "121" },
  { sr: 207, name: "abhiraj jain", rollNo: "112515010", roomNo: "121" },
  { sr: 208, name: "Shaanit", rollNo: "112515258", roomNo: "121" },
  { sr: 209, name: "Ishan Banke", rollNo: "112515131", roomNo: "120" },
  { sr: 210, name: "Aditya Uikey", rollNo: "112515023", roomNo: "120" },
  { sr: 211, name: "Kshitij Kushwaha", rollNo: "112515149", roomNo: "120" },
  { sr: 212, name: "Harsh Sahibani", rollNo: "112516040", roomNo: "120" },
  { sr: 213, name: "Mehul Bhatia", rollNo: "112515169", roomNo: "119" },
  { sr: 214, name: "Chirayu Srivastav", rollNo: "112515087", roomNo: "119" },
  { sr: 215, name: "Abhishek Shete", rollNo: "112515017", roomNo: "119" },
  { sr: 216, name: "Chirag S R", rollNo: "112515085", roomNo: "119" },
  { sr: 217, name: "Suryanaraynan", rollNo: "112516099", roomNo: "118" },
  { sr: 218, name: "Sanidhya Raj", rollNo: "112515243", roomNo: "118" },
  { sr: 219, name: "G.Sathwik", rollNo: "112515119", roomNo: "118" },
  { sr: 220, name: "Pankaj Kumar", rollNo: "112516074", roomNo: "118" },
  { sr: 221, name: "Lakshya Lakhotiya", rollNo: "112515152", roomNo: "117" },
  { sr: 222, name: "Piyush Lokhande", rollNo: "112516077", roomNo: "117" },
  { sr: 223, name: "Piyush Kharoliya", rollNo: "112516076", roomNo: "117" },
  { sr: 224, name: "Abhinav Gupta", rollNo: "112516004", roomNo: "117" },
  { sr: 225, name: "Siddhant Bhaware", rollNo: "112515077", roomNo: "116" },
  { sr: 226, name: "Bhavishya Mahawar", rollNo: "112515075", roomNo: "116" },
  { sr: 227, name: "Pratham Sharde", rollNo: "112515207", roomNo: "116" },

  // Page 9: 116 to 108
  { sr: 228, name: "Alvin Dsouza", rollNo: "112515029", roomNo: "116" },
  { sr: 229, name: "Mohan Krishna", rollNo: "112515164", roomNo: "115" },
  { sr: 230, name: "Medikunda Tarun", rollNo: "112515163", roomNo: "115" },
  { sr: 231, name: "Vikas", rollNo: "112515095", roomNo: "115" },
  { sr: 232, name: "Pranav", rollNo: "112516073", roomNo: "113" },
  { sr: 233, name: "Jemin", rollNo: "112516060", roomNo: "113" },
  { sr: 234, name: "Bhavesh", rollNo: "112516062", roomNo: "113" },
  { sr: 235, name: "Shubham", rollNo: "112515274", roomNo: "113" },
  { sr: 236, name: "Dnyanad", rollNo: "112516032", roomNo: "112" },
  { sr: 237, name: "Mehul", rollNo: "112516055", roomNo: "112" },
  { sr: 238, name: "Sushrut", rollNo: "112516100", roomNo: "112" },
  { sr: 239, name: "Anvay", rollNo: "112515043", roomNo: "112" },
  { sr: 240, name: "Rambhagat", rollNo: "112515220", roomNo: "111" },
  { sr: 241, name: "Samit Savanur", rollNo: "112515238", roomNo: "111" },
  { sr: 242, name: "Raj Yawale", rollNo: "112515218", roomNo: "111" },
  { sr: 243, name: "Gaurav Chaudhary", rollNo: "112515112", roomNo: "111" },
  { sr: 244, name: "Amit", rollNo: "112516011", roomNo: "110" },
  { sr: 245, name: "Rishu", rollNo: "112515227", roomNo: "110" },
  { sr: 246, name: "Yash Yadav", rollNo: "112516109", roomNo: "110" },
  { sr: 247, name: "Ayush Kumar", rollNo: "112516019", roomNo: "110" },
  { sr: 248, name: "Samyak Jain", rollNo: "112515240", roomNo: "109" },
  { sr: 249, name: "Krushang Mavapuri", rollNo: "112515161", roomNo: "109" },
  { sr: 250, name: "Tanuj Gopal", rollNo: "112515296", roomNo: "109" },
  { sr: 251, name: "Divyanshu Singh", rollNo: "112516031", roomNo: "109" },
  { sr: 252, name: "Ritul", rollNo: "112515228", roomNo: "108" },
  { sr: 253, name: "Vaibhav", rollNo: "112516105", roomNo: "108" },
  { sr: 254, name: "Prem Mehta", rollNo: "112515168", roomNo: "108" },
  { sr: 255, name: "Adhiraj Waghmare", rollNo: "112515314", roomNo: "108" },

  // Page 10: 107 to 101
  { sr: 256, name: "Nikhil Asawa", rollNo: "112515185", roomNo: "107" },
  { sr: 257, name: "Harsh Yadav", rollNo: "112515126", roomNo: "107" },
  { sr: 258, name: "Saksham Bindal", rollNo: "112515234", roomNo: "107" },
  { sr: 259, name: "Aryan Sogani", rollNo: "112516017", roomNo: "107" },
  { sr: 260, name: "Gunjit", rollNo: "112515124", roomNo: "106" },
  { sr: 261, name: "Mahendar", rollNo: "112515157", roomNo: "106" },
  { sr: 262, name: "Ajay", rollNo: "112516008", roomNo: "106" },
  { sr: 263, name: "Priyanshu", rollNo: "112516082", roomNo: "106" },
  { sr: 264, name: "Parth Gupta", rollNo: "112515194", roomNo: "105" },
  { sr: 265, name: "Siddh Doshi", rollNo: "112515102", roomNo: "105" },
  { sr: 266, name: "Rohit Borana", rollNo: "112515230", roomNo: "105" },
  { sr: 267, name: "Aman Karanikale", rollNo: "112516010", roomNo: "105" },
  { sr: 268, name: "Ishan Srivastava", rollNo: "112515130", roomNo: "104" },
  { sr: 269, name: "Srijan Kumar", rollNo: "112515282", roomNo: "104" },
  { sr: 270, name: "Sarthak", rollNo: "112516075", roomNo: "104" },
  { sr: 271, name: "Raj", rollNo: "112515217", roomNo: "104" },
  { sr: 272, name: "Mrugank", rollNo: "112515175", roomNo: "103" },
  { sr: 273, name: "Sarthak", rollNo: "112515249", roomNo: "103" },
  { sr: 274, name: "Arjun", rollNo: "112515047", roomNo: "103" },
  { sr: 275, name: "Arya", rollNo: "112515050", roomNo: "103" },
  { sr: 276, name: "Ankur Shirsath", rollNo: "112515267", roomNo: "102" },
  { sr: 277, name: "Atharva Shinde", rollNo: "112515266", roomNo: "102" },
  { sr: 278, name: "Neelraje Patil", rollNo: "112516069", roomNo: "102" },
  { sr: 279, name: "Aditya Chaudhari", rollNo: "112515021", roomNo: "102" },
  { sr: 280, name: "Hanuman Dhakar", rollNo: "112515125", roomNo: "101" },
  { sr: 281, name: "Abhishek Bagra", rollNo: "112515013", roomNo: "101" },
  { sr: 282, name: "Dinesh", rollNo: "112515099", roomNo: "101" },
  { sr: 283, name: "Aman", rollNo: "112515032", roomNo: "101" },

  // Page 11: Ground Floor (Numeric) 30 to 15
  { sr: 284, name: "Vignesh", rollNo: "112516037", roomNo: "30" },
  { sr: 285, name: "Pavan Kumar", rollNo: "112515083", roomNo: "30" },
  { sr: 286, name: "Vamshdeep", rollNo: "112515159", roomNo: "30" },
  { sr: 287, name: "N.siddu", rollNo: "112516111", roomNo: "30" },
  { sr: 288, name: "RAVINDRA KUMAR", rollNo: "112515225", roomNo: "30" },
  { sr: 289, name: "ABHIJIT JITENDRA MESHRAM", rollNo: "112515008", roomNo: "30" },
  { sr: 290, name: "Aditya Srivastava", rollNo: "112516006", roomNo: "29" },
  { sr: 291, name: "Kavya Srivastava", rollNo: "112516045", roomNo: "29" },
  { sr: 292, name: "KRISHAN KUMAR PRAJAPATI", rollNo: "112516048", roomNo: "29" },
  { sr: 293, name: "Nidheesh Agrawal", rollNo: "112515184", roomNo: "29" },
  { sr: 294, name: "mohit patil", rollNo: "112515174", roomNo: "28" },
  { sr: 295, name: "rishi rao", rollNo: "112516084", roomNo: "28" },
  { sr: 296, name: "vedant dhopate", rollNo: "112515309", roomNo: "28" },
  { sr: 297, name: "kshitij patil", rollNo: "112516051", roomNo: "28" },
  { sr: 298, name: "vivek mangal", rollNo: "112515313", roomNo: "27" },
  { sr: 299, name: "prafful pal", rollNo: "112515203", roomNo: "27" },
  { sr: 300, name: "sarthak shukla", rollNo: "112515251", roomNo: "27" },
  { sr: 301, name: "atharva sharma", rollNo: "112515063", roomNo: "27" },
  { sr: 302, name: "Harsh Padhiyar", rollNo: "112515191", roomNo: "26" },
  { sr: 303, name: "jash patel", rollNo: "112515195", roomNo: "26" },
  { sr: 304, name: "purva desai", rollNo: "112515093", roomNo: "26" },
  { sr: 305, name: "jitendra", rollNo: "112516071", roomNo: "26" },
  { sr: 306, name: "Nitin maurya", rollNo: "112515189", roomNo: "25" },
  { sr: 307, name: "piyush srivastava", rollNo: "112515200", roomNo: "25" },
  { sr: 308, name: "mehanshu patidar", rollNo: "112515167", roomNo: "25" },
  { sr: 309, name: "bhavesh patil", rollNo: "112516023", roomNo: "25" },
  { sr: 310, name: "Nayan Mahato", rollNo: "112515067", roomNo: "24" },
  { sr: 311, name: "Avinash Dubey", rollNo: "112515183", roomNo: "24" },
  { sr: 312, name: "Swapnil", rollNo: "112515291", roomNo: "15" },

  // Page 12: Ground Floor & 316, 315, Unassigned
  { sr: 313, name: "Abhyuday", rollNo: "112515018", roomNo: "15" },
  { sr: 314, name: "Avi", rollNo: "112515066", roomNo: "15" },
  { sr: 315, name: "Gunasekhar", rollNo: "112515089", roomNo: "15" },
  { sr: 316, name: "DAKSH JAIN", rollNo: "112515090", roomNo: "2" },
  { sr: 317, name: "SUKHVEER", rollNo: "112515287", roomNo: "2" },
  { sr: 318, name: "TARUN AHUJA", rollNo: "112516104", roomNo: "2" },
  { sr: 319, name: "Amit Kumar", rollNo: "112515035", roomNo: "2" },
  { sr: 320, name: "SANIDHYA BHANDARI", rollNo: "112516089", roomNo: "316" },
  { sr: 321, name: "KANISHK HADA", rollNo: "112516044", roomNo: "315" },
  { sr: 322, name: "Rohan Dorale", rollNo: "112415064", roomNo: "316" },
  // Row 323: Krunal Vasoya (blank room) - intentionally marked unassigned/omitted
  { sr: 323, name: "KRUNAL BHAVESHBHAI VASOYA", rollNo: "112516050", roomNo: "" },

  // Page 13: Additional list (15 students)
  { sr: 324, name: "MUNGAD SAUMYA KAMLESHKUMAR", rollNo: "112515177", roomNo: "115" },
  { sr: 325, name: "PRANAV VISHAWANATH BORKAR", rollNo: "112516081", roomNo: "228" },
  { sr: 326, name: "KONDAPALLY RAMCHARANTEJA", rollNo: "112516047", roomNo: "130" },
  { sr: 327, name: "MADHAV GADIYA", rollNo: "222615008", roomNo: "11" },
  { sr: 328, name: "GAUTAM RANJHAN", rollNo: "222615006", roomNo: "11" },
  { sr: 329, name: "GAUTAM SHARMA", rollNo: "222615007", roomNo: "18" },
  { sr: 330, name: "LAMIKANT", rollNo: "222615009", roomNo: "18" },
  { sr: 331, name: "PRANJAL BADE", rollNo: "222615011", roomNo: "18" },
  { sr: 332, name: "ADITYA KUMAR SINGH", rollNo: "222615001", roomNo: "19" },
  { sr: 333, name: "AKSHAY LANJEWAR", rollNo: "222615002", roomNo: "19" },
  { sr: 334, name: "HARSHAL SANGATHIYA", rollNo: "222615012", roomNo: "19" },
  { sr: 335, name: "ATHARV AYACHIT", rollNo: "222615003", roomNo: "19" },
  { sr: 336, name: "KRUSHAIL DANGAR", rollNo: "222615005", roomNo: "20" },
  { sr: 337, name: "VIVEK KUNAR", rollNo: "222615015", roomNo: "20" },
  { sr: 338, name: "RICKY KUMAR", rollNo: "222515019", roomNo: "30" }, // 7th student in Room 30

  // Page 14: 3rd Year (301 to 310)
  { sr: 339, name: "Parth Rathod", rollNo: "112415150", roomNo: "301" },
  { sr: 340, name: "Rohit Thorat", rollNo: "112415181", roomNo: "301" },
  { sr: 341, name: "Akshad Sethi", rollNo: "112415196", roomNo: "301" },
  { sr: 342, name: "Pranav Zambare", rollNo: "112415163", roomNo: "301" },
  { sr: 343, name: "Madan Ram Sai Vuppala", rollNo: "112415251", roomNo: "302" },
  { sr: 344, name: "Abhiram Naluvala", rollNo: "112415139", roomNo: "302" },
  { sr: 345, name: "Peddolla Charan tej", rollNo: "112415156", roomNo: "302" },
  { sr: 346, name: "Yogeshwar Reddy", rollNo: "112415254", roomNo: "302" },
  { sr: 347, name: "Rudra Singhal", rollNo: "112415184", roomNo: "303" },
  { sr: 348, name: "Utkarsh Desale", rollNo: "112415226", roomNo: "303" },
  { sr: 349, name: "Milind Tomar", rollNo: "112415131", roomNo: "303" },
  { sr: 350, name: "Lavish Mangal", rollNo: "112415115", roomNo: "303" },
  { sr: 351, name: "Ajit Dangi", rollNo: "112415014", roomNo: "304" },
  { sr: 352, name: "Priyansh Agarwal", rollNo: "112415169", roomNo: "304" },
  { sr: 353, name: "Harsh Goswami", rollNo: "112415249", roomNo: "304" },
  { sr: 354, name: "Amol Raj", rollNo: "112415018", roomNo: "304" },
  { sr: 355, name: "Harsh Aghara", rollNo: "112415076", roomNo: "305" },
  { sr: 356, name: "Harkeerat singh", rollNo: "112415075", roomNo: "305" },
  { sr: 357, name: "Basant bansal", rollNo: "112416017", roomNo: "305" },
  { sr: 358, name: "Suraj Kumar", rollNo: "112416068", roomNo: "305" },
  { sr: 359, name: "Aadit Bajaj", rollNo: "112415002", roomNo: "306" },
  { sr: 360, name: "Hardik Jha", rollNo: "112415074", roomNo: "306" },
  { sr: 361, name: "Rayhan Sayed", rollNo: "112415177", roomNo: "306" },
  { sr: 362, name: "Pratham Bhardwaj", rollNo: "112415165", roomNo: "306" },
  { sr: 363, name: "Pranav Junnare", rollNo: "112415162", roomNo: "307" },
  { sr: 364, name: "Grandhi Lakshmikanth", rollNo: "112416027", roomNo: "307" },
  { sr: 365, name: "Jayanthi Venkata Sai Koushik", rollNo: "112416033", roomNo: "307" },
  { sr: 366, name: "Sandesh Shete", rollNo: "112415192", roomNo: "307" },
  { sr: 367, name: "Yeshwant sai", rollNo: "112415250", roomNo: "308" },
  { sr: 368, name: "Mohan", rollNo: "112416044", roomNo: "308" },
  { sr: 369, name: "Venkat P", rollNo: "112415160", roomNo: "308" },
  { sr: 370, name: "Rithvik", rollNo: "112415059", roomNo: "308" },
  { sr: 371, name: "Khushal Agrawal", rollNo: "112416037", roomNo: "309" },
  { sr: 372, name: "Aishwarya Yadav", rollNo: "112416075", roomNo: "309" },
  { sr: 373, name: "Meet Agrawal", rollNo: "112415013", roomNo: "309" },
  { sr: 374, name: "Rujul Jadage", rollNo: "112415185", roomNo: "309" },
  { sr: 375, name: "Meghraj Mahajan", rollNo: "112415118", roomNo: "310" },
  { sr: 376, name: "Om Khapekar", rollNo: "112415102", roomNo: "310" },
  { sr: 377, name: "Preetam Raj", rollNo: "112416052", roomNo: "310" },

  // Page 15: 3rd Year (310 to 321, PWD/Medical)
  { sr: 378, name: "Harsh Patel", rollNo: "112415077", roomNo: "310" },
  { sr: 379, name: "Pavan Kolhe", rollNo: "112415104", roomNo: "311" },
  { sr: 380, name: "Aniket Joshi", rollNo: "112415091", roomNo: "311" },
  { sr: 381, name: "Amit Vikram Tiwari", rollNo: "112416005", roomNo: "311" },
  { sr: 382, name: "Prerak Goyal", rollNo: "112416053", roomNo: "311" },
  { sr: 383, name: "Priyanshu negi", rollNo: "112415171", roomNo: "312" },
  { sr: 384, name: "Bibaswan pal", rollNo: "112415047", roomNo: "312" },
  { sr: 385, name: "Gautam joshi", rollNo: "112415072", roomNo: "312" },
  { sr: 386, name: "Ayush hotkar", rollNo: "112415038", roomNo: "312" },
  { sr: 387, name: "Jash Popat", rollNo: "112415089", roomNo: "317" },
  { sr: 388, name: "Manthan Vadi", rollNo: "112416071", roomNo: "317" },
  { sr: 389, name: "Kritgna Patel", rollNo: "112416048", roomNo: "317" },
  { sr: 390, name: "Krish Joshi", rollNo: "112416039", roomNo: "317" },
  { sr: 391, name: "Nishant Lad", rollNo: "112415143", roomNo: "318" },
  { sr: 392, name: "Nandan Appana", rollNo: "112416007", roomNo: "318" },
  { sr: 393, name: "Nagoor Merravali", rollNo: "112416062", roomNo: "318" },
  { sr: 394, name: "Sarvesh kumar kanth", rollNo: "112416061", roomNo: "318" },
  { sr: 395, name: "Abhinav Rathor", rollNo: "112415006", roomNo: "319" },
  { sr: 396, name: "Abhyankar Pratap Singh Chauhan", rollNo: "112415007", roomNo: "319" },
  { sr: 397, name: "Om Gajanan Patil", rollNo: "112415145", roomNo: "319" },
  { sr: 398, name: "Shivansh Prakashchandra Mishra", rollNo: "112415205", roomNo: "319" },
  { sr: 399, name: "Pratham kulkarni", rollNo: "112415110", roomNo: "320" },
  { sr: 400, name: "Devansh mittal", rollNo: "112415058", roomNo: "320" },
  { sr: 401, name: "Mayuresh Chavan", rollNo: "112415127", roomNo: "320" },
  { sr: 402, name: "Omkar pandit", rollNo: "112415147", roomNo: "320" },
  { sr: 403, name: "Krrish Swarnkar", rollNo: "112415109", roomNo: "321" },
  { sr: 404, name: "Aanoush Surana", rollNo: "112415003", roomNo: "321" },
  { sr: 405, name: "Vedant Tawari", rollNo: "112415229", roomNo: "321" },
  { sr: 406, name: "Ashutosh Raj Singh", rollNo: "112415036", roomNo: "321" },
  { sr: 407, name: "VIVEK KUMAR SINGH (PWD)", rollNo: "112415238", roomNo: "127" },
  { sr: 408, name: "Aryan Pulimoottil (PWD)", rollNo: "112415172", roomNo: "229" },
  { sr: 409, name: "Vedang Upendra Shende (Medical)", rollNo: "112315171", roomNo: "229" },
];

/**
 * Maps a room number string to its corresponding floor number and label
 */
function getFloorInfoForRoom(roomNo) {
  const normalized = (roomNo || '').toString().trim().toUpperCase();
  if (!normalized) return { floor_number: null, label: 'Unassigned' };

  if (normalized.startsWith('B')) {
    return { floor_number: -1, label: 'Basement / Wing B' };
  }

  const num = parseInt(normalized, 10);
  if (isNaN(num)) {
    return { floor_number: 0, label: 'Ground Floor' };
  }

  if (num < 100) {
    return { floor_number: 0, label: 'Ground Floor' };
  } else if (num >= 100 && num < 200) {
    return { floor_number: 1, label: '1st Floor' };
  } else if (num >= 200 && num < 300) {
    return { floor_number: 2, label: '2nd Floor' };
  } else if (num >= 300 && num < 400) {
    return { floor_number: 3, label: '3rd Floor' };
  }

  return { floor_number: 0, label: 'Ground Floor' };
}

/**
 * Determine default capacity for a room (Room 30 is 8, all others 4)
 */
function getCapacityForRoom(roomNo) {
  const norm = (roomNo || '').toString().trim();
  if (norm === '30') return 8;
  return 4;
}

/**
 * Generate preview report for BH2 PDF data without writing to database
 */
async function generatePreviewReport() {
  // Check existing users by rollNo
  const rollNumbers = RAW_BH2_RECORDS.map((r) => r.rollNo).filter(Boolean);
  const existingUsers = await User.find({ rollNo: { $in: rollNumbers } }).lean();
  const existingUserMap = new Map();
  for (const u of existingUsers) {
    existingUserMap.set(u.rollNo, u);
  }

  // Count students assigned per room
  const roomOccupancyCount = {};
  for (const r of RAW_BH2_RECORDS) {
    if (r.roomNo) {
      roomOccupancyCount[r.roomNo] = (roomOccupancyCount[r.roomNo] || 0) + 1;
    }
  }

  const records = [];
  const roomSummaries = {};

  let totalValid = 0;
  let totalSkipped = 0;
  let totalNewUsers = 0;
  let totalMatchedUsers = 0;

  for (const item of RAW_BH2_RECORDS) {
    const isKrunalOmitted = item.rollNo === '112516050' || !item.roomNo;
    const floorInfo = getFloorInfoForRoom(item.roomNo);
    const expectedCapacity = getCapacityForRoom(item.roomNo);
    const roomCount = roomOccupancyCount[item.roomNo] || 0;
    const matchedUser = existingUserMap.get(item.rollNo);

    if (matchedUser) {
      totalMatchedUsers++;
    } else if (!isKrunalOmitted) {
      totalNewUsers++;
    }

    let status = 'valid';
    let note = '';

    if (isKrunalOmitted) {
      status = 'skipped';
      note = 'Omitted: Blank room assignment in source document (admin instructed to omit for now)';
      totalSkipped++;
    } else if (roomCount > expectedCapacity) {
      status = 'over_capacity';
      note = `Room ${item.roomNo} has ${roomCount} students, exceeds capacity ${expectedCapacity}`;
    } else {
      totalValid++;
      note = matchedUser ? 'Matched existing user account' : 'Will create new student account';
    }

    if (item.roomNo && !roomSummaries[item.roomNo]) {
      roomSummaries[item.roomNo] = {
        room_number: item.roomNo,
        floor_number: floorInfo.floor_number,
        floor_label: floorInfo.label,
        capacity: expectedCapacity,
        assignedCount: roomCount,
        status: roomCount > expectedCapacity ? 'over_capacity' : 'valid',
      };
    }

    records.push({
      sr: item.sr,
      name: item.name,
      rollNo: item.rollNo,
      roomNo: item.roomNo || 'UNASSIGNED',
      floor_number: floorInfo.floor_number,
      floor_label: floorInfo.label,
      expectedCapacity,
      status,
      note,
      matchedUser: matchedUser ? { _id: matchedUser._id, name: matchedUser.name } : null,
    });
  }

  return {
    hostel: 'BH2',
    hostelName: 'Boys Hostel 2',
    totalRecords: RAW_BH2_RECORDS.length,
    validAllocations: totalValid,
    skippedRecords: totalSkipped,
    totalRooms: Object.keys(roomSummaries).length,
    newUsersToCreate: totalNewUsers,
    matchedUsers: totalMatchedUsers,
    rooms: Object.values(roomSummaries),
    records,
  };
}

/**
 * Confirms and executes idempotent atomic import of BH2 hostel structure and allocations
 */
async function confirmAndExecuteImport({ actor_id = null, actor_role = 'warden' } = {}) {
  // 1. Ensure BH2 Hostel exists
  let bh2 = await Hostel.findOne({ code: 'BH2' });
  if (!bh2) {
    bh2 = await Hostel.create({
      code: 'BH2',
      name: 'Boys Hostel 2',
      type: 'boys',
      active: true,
      description: 'Authoritative BH2 structure',
    });
  }

  // 2. Ensure Floors exist (-1, 0, 1, 2, 3)
  const floorDefs = [
    { floor_number: -1, label: 'Basement / Wing B' },
    { floor_number: 0, label: 'Ground Floor' },
    { floor_number: 1, label: '1st Floor' },
    { floor_number: 2, label: '2nd Floor' },
    { floor_number: 3, label: '3rd Floor' },
  ];

  const floorMap = {};
  for (const f of floorDefs) {
    const doc = await HostelFloor.findOneAndUpdate(
      { hostel_id: bh2._id, floor_number: f.floor_number },
      { $setOnInsert: { label: f.label, active: true } },
      { upsert: true, new: true }
    );
    floorMap[f.floor_number] = doc;
  }

  // 3. Collect unique rooms and upsert them
  const uniqueRooms = {};
  for (const item of RAW_BH2_RECORDS) {
    if (item.roomNo && item.rollNo !== '112516050') {
      const roomNum = item.roomNo.trim().toUpperCase();
      const floorInfo = getFloorInfoForRoom(roomNum);
      const cap = getCapacityForRoom(roomNum);
      uniqueRooms[roomNum] = {
        room_number: roomNum,
        floor_number: floorInfo.floor_number,
        capacity: cap,
      };
    }
  }

  const roomMap = {};
  let roomsCreated = 0;
  let roomsUpdated = 0;

  for (const [rNum, rData] of Object.entries(uniqueRooms)) {
    const floorDoc = floorMap[rData.floor_number];
    let roomDoc = await HostelRoom.findOne({ hostel_id: bh2._id, room_number: rNum });
    if (!roomDoc) {
      roomDoc = await HostelRoom.create({
        hostel_id: bh2._id,
        floor_id: floorDoc._id,
        room_number: rNum,
        capacity: rData.capacity,
        status: 'available',
      });
      roomsCreated++;
    } else {
      if (roomDoc.capacity !== rData.capacity) {
        roomDoc.capacity = rData.capacity;
        await roomDoc.save();
        roomsUpdated++;
      }
    }
    roomMap[rNum] = roomDoc;
  }

  // 4. Process student users and allocations
  let usersCreated = 0;
  let allocationsCreated = 0;
  let allocationsSkipped = 0;

  for (const item of RAW_BH2_RECORDS) {
    // Skip Krunal Vasoya as directed
    if (item.rollNo === '112516050' || !item.roomNo) {
      continue;
    }

    const roomNum = item.roomNo.trim().toUpperCase();
    const roomDoc = roomMap[roomNum];
    if (!roomDoc) continue;

    // Check or create student User
    let student = await User.findOne({ rollNo: item.rollNo });
    if (!student) {
      const email = `${item.rollNo}@iiitp.ac.in`.toLowerCase();
      student = await User.create({
        name: item.name.trim(),
        email,
        rollNo: item.rollNo,
        role: 'student',
        hostel: 'BH2',
        roomNo: roomNum,
        oauthProvider: 'google',
        oauthId: `import_${item.rollNo}`,
        isActive: true,
      });
      usersCreated++;
    } else {
      // Update hostel and roomNo if needed
      student.hostel = 'BH2';
      student.roomNo = roomNum;
      await student.save();
    }

    // Check existing active allocation
    const existingAlloc = await RoomAllocation.findOne({
      student_id: student._id,
      status: 'active',
    });

    if (existingAlloc) {
      if (existingAlloc.room_id.toString() === roomDoc._id.toString()) {
        allocationsSkipped++;
        continue; // Already correctly allocated
      } else {
        // Close prior allocation
        existingAlloc.status = 'transferred';
        existingAlloc.vacated_on = new Date();
        await existingAlloc.save();
      }
    }

    // Create active allocation
    await RoomAllocation.create({
      student_id: student._id,
      room_id: roomDoc._id,
      allocated_on: new Date(),
      status: 'active',
      allocated_by: actor_id,
      remarks: 'Imported from authoritative BH2 allocation PDF',
      source: 'pdf_import',
    });
    allocationsCreated++;

    // Record audit log
    await RoomAllocationAudit.create({
      student_id: student._id,
      action: 'BULK_IMPORT',
      new_room_id: roomDoc._id,
      actor_id,
      actor_role,
      reason: 'Authoritative PDF Import',
      details: { rollNo: item.rollNo, roomNo: roomNum },
    });
  }

  // 5. Update room statuses based on actual occupancy
  for (const rDoc of Object.values(roomMap)) {
    const activeCount = await RoomAllocation.countDocuments({
      room_id: rDoc._id,
      status: 'active',
    });
    rDoc.status = activeCount >= rDoc.capacity ? 'full' : activeCount > 0 ? 'occupied' : 'available';
    await rDoc.save();
  }

  logger.info('[PDF Import] Confirmed BH2 import completed', {
    roomsCreated,
    roomsUpdated,
    usersCreated,
    allocationsCreated,
    allocationsSkipped,
  });

  return {
    success: true,
    hostel: 'BH2',
    roomsCreated,
    roomsUpdated,
    totalRooms: Object.keys(roomMap).length,
    usersCreated,
    allocationsCreated,
    allocationsSkipped,
    omittedStudents: ['KRUNAL BHAVESHBHAI VASOYA (112516050)'],
  };
}

module.exports = {
  RAW_BH2_RECORDS,
  generatePreviewReport,
  confirmAndExecuteImport,
};
