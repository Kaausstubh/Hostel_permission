const fs = require('fs');
const path = require('path');

// Raw text from OCR of all 15 pages provided in user prompt
const pagesData = [
  // Page 1
  {
    page: 1,
    header: "Second Year Students Lists 2026-2027",
    rows: [
      [1, "roshan paner", "112515231", "B13"],
      [2, "prathemesh dhage", "112515208", "B13"],
      [3, "rohan dighe", "112516085", "B13"],
      [4, "rishabh agrawal", "112515226", "B13"],
      [5, "jatin", "112516042", "B12"],
      [6, "minesh sihra", "112516056", "B12"],
      [7, "chintransh nagar", "112515088", "B12"],
      [8, "atharva verma", "112516018", "B12"],
      [9, "Akash Kale", "112515025", "B11"],
      [10, "Aniket Rite", "112515036", "B11"],
      [11, "Atharva Ekal", "112515060", "B11"],
      [12, "Aman Kumar", "112515031", "B11"],
      [13, "Varun Sandesh", "112515308", "B10"],
      [14, "Shivasai Bacha", "112515268", "B10"],
      [15, "Sivakrishna", "112515306", "B10"],
      [16, "Rohit", "112516022", "B10"],
      [17, "Aryan Garad", "112515110", "B09"],
      [18, "Tushar Mukund", "112515304", "B09"],
      [19, "Aniket Kadam", "112515136", "B09"],
      [20, "Tanmay Durgam", "112516101", "B09"],
      [21, "M.Omeshhon Reddy", "112515176", "B08"],
      [22, "Tanish Bafna", "112515294", "B08"],
      [23, "Atharva Chavan", "112515061", "B08"],
      [24, "Anil Choudhary", "112516012", "B08"],
      [25, "Dhawal", "112515098", "B07"],
      [26, "Tanmay Tejas", "112516102", "B07"],
      [27, "Rajan Raman", "112516083", "B07"],
    ]
  },
  // Page 2
  {
    page: 2,
    header: "Second Year Students Lists 2026-2027",
    rows: [
      [28, "Satvik Khanna", "112515253", "B07"],
      [29, "Harsh Vishvakarma", "112516041", "B06"],
      [30, "Tanishk Khandelwal", "112515295", "B06"],
      [31, "Harsha", "112515138", "B06"],
      [32, "Ayush Jadhav", "112516002", "B06"],
      [33, "Satyam", "112515254", "B05"],
      [34, "Siddharth", "112515275", "B05"],
      [35, "Aryan Singh", "112515054", "B05"],
      [36, "Anjal", "112515038", "B05"],
      [37, "Soham Jawade", "112515279", "B03"],
      [38, "Shlok Shah", "112515260", "B03"],
      [39, "Akshit Agrawal", "112516009", "B03"],
      [40, "Kathan Shah", "112515259", "B03"],
      [41, "Bhargav Kachadiya", "112515135", "B02"],
      [42, "Kavya Patel", "112515140", "B02"],
      [43, "Nitya Jain", "112516070", "B02"],
      [44, "Krishna Yadav", "112516049", "B02"],
      [45, "Atharva Agrawal", "112515058", "B01"],
      [46, "Amber Agrawari", "112515034", "B01"],
      [47, "Aryan Singhwal", "112515055", "B01"],
      [48, "SHAHNAWAZ MEMON", "112515261", "313"],
      [49, "Faheem", "112515108", "313"],
      [50, "Fawaz", "112515172", "313"],
      [51, "Yazeed", "112515317", "313"],
      [52, "Yashraj", "112515315", "234"],
      [53, "Samyak kamble", "112515239", "234"],
      [54, "Boorla Abhiram", "112516024", "234"],
      [55, "Aryan Mandape", "112515052", "234"],
      [56, "meet varma", "112515166", "233"],
    ]
  },
  // Page 3
  {
    page: 3,
    header: "Second Year Students Lists 2026-2027",
    rows: [
      [57, "chinmay jain", "112515084", "233"],
      [58, "preshit sapkale", "112516091", "233"],
      [59, "ayush kumar", "112515068", "233"],
      [60, "Arpit Bhati", "112516015", "232"],
      [61, "Pranshu Goyal", "112515206", "232"],
      [62, "Vishesh", "112516092", "232"],
      [63, "Prathamesh Sonawane", "112515280", "232"],
      [64, "gaurav", "112516036", "231"],
      [65, "shresth", "112515271", "231"],
      [66, "siddhartha", "112515224", "231"],
      [67, "dhananjay", "112515097", "231"],
      [68, "shrest vikas reddy", "112515160", "230"],
      [69, "t. shivamani", "112515299", "230"],
      [70, "ruchir", "112515192", "230"],
      [71, "abhiram chaitanya", "112516090", "230"],
      [72, "Ayush Agrawal", "112515006", "227"],
      [73, "Siddharth S", "112516097", "226"],
      [74, "Manideep Yadav", "112515182", "226"],
      [75, "Chandravardhan Reddy", "112515311", "226"],
      [76, "Yuvraj", "112516110", "225"],
      [77, "Sarthak Gaikwad", "112515248", "225"],
      [78, "Shashank Shirurkar", "112516096", "225"],
      [79, "Yash Narayan", "112516108", "225"],
      [80, "Bhuvan narang", "112515078", "224"],
      [81, "Rahul Uikey", "112515216", "224"],
      [82, "Chaitanya", "112515081", "224"],
      [83, "Vimarsh", "112515312", "224"],
      [84, "Abhishek George", "112515015", "223"],
      [85, "Nandkishore", "112515180", "223"],
    ]
  },
  // Page 4
  {
    page: 4,
    header: "Second Year Students Lists 2026-2027",
    rows: [
      [86, "Mohn. Akhas", "112515171", "223"],
      [87, "E. Himnesh", "112516034", "223"],
      [88, "Shivraj", "112515269", "222"],
      [89, "Sandesh", "112515242", "222"],
      [90, "Aryan", "112515053", "222"],
      [91, "Atharva Patil", "112515059", "222"],
      [92, "Abhyudya Singh", "112516005", "221"],
      [93, "Pratik Goyal", "112515209", "221"],
      [94, "Yug Limachiya", "112516052", "221"],
      [95, "Harsh Patidar", "112516039", "221"],
      [96, "Darsheel", "112516025", "220"],
      [97, "Aditiya yadav", "112516007", "220"],
      [98, "arin jain", "112515046", "220"],
      [99, "utpal singh", "112515307", "220"],
      [100, "krish", "112515148", "219"],
      [101, "meet fadia", "112515165", "219"],
      [102, "harmik", "112515233", "219"],
      [103, "Keshav Yadav", "112515142", "218"],
      [104, "Jatin Kumar", "112515133", "218"],
      [105, "Adarsh Agarwala", "112515019", "218"],
      [106, "Ankit Anand", "112515039", "218"],
      [107, "Madhav Nagar", "112515156", "217"],
      [108, "Sarthak Chouhan", "112515250", "217"],
      [109, "k. neeraj", "112515146", "217"],
      [110, "Rakshit Rao", "112515219", "217"],
      [111, "Tejas Majgawali", "112515298", "215"],
      [112, "Gaurvendra Singh", "112515114", "215"],
      [113, "Kishor Kumar", "112515223", "215"],
    ]
  },
  // Page 5
  {
    page: 5,
    header: "Second Year Students Lists 2026-2027",
    rows: [
      [114, "Atharva Khunte", "112515062", "215"],
      [115, "Kiran Mylabathula", "112515179", "214"],
      [116, "Ayush L", "112515154", "214"],
      [117, "Kota Pawan Yagnesh", "112515147", "214"],
      [118, "Keshav Giri", "112515141", "214"],
      [119, "Sanskar Kokate", "112515145", "213"],
      [120, "anish valke", "112515037", "213"],
      [121, "abhishek patil", "112515012", "213"],
      [122, "Ram Chopade", "112515221", "213"],
      [123, "Ayushman Ghosh", "112515072", "212"],
      [124, "Ashish sewda", "112515056", "212"],
      [125, "het", "112515276", "212"],
      [126, "ayush polara", "112515202", "212"],
      [127, "Shikhar Saxena", "112516095", "211"],
      [128, "Abhinav Reddy", "112515117", "211"],
      [129, "Akshat Mudhale", "112515028", "211"],
      [130, "Aaditya Nawandar", "112515002", "211"],
      [131, "Dasari Krithik", "112515091", "210"],
      [132, "Tanay Eedha", "112515106", "210"],
      [133, "Madhu", "112516033", "210"],
      [134, "Aditya Macharla", "112515155", "210"],
      [135, "Dipanshu Yadav", "112515100", "209"],
      [136, "Ayush Singh", "112515070", "209"],
      [137, "Arjun Mishra", "112515048", "209"],
      [138, "Atharva Deshmukh", "112515064", "209"],
      [139, "Aditya Purohit", "112515022", "208"],
      [140, "Pushpak Kanhed", "112515215", "208"],
      [141, "Aadhar Prajapati", "112515001", "208"],
    ]
  },
  // Page 6
  {
    page: 6,
    header: "Second Year Students Lists 2026-2027",
    rows: [
      [142, "Sagar", "112516086", "208"],
      [143, "Dheeraj Kumar", "112516029", "207"],
      [144, "Mohammed Rayan", "112516059", "207"],
      [145, "Dhanraj", "112516028", "207"],
      [146, "Sheikh Rayyan", "112515262", "207"],
      [147, "Himanshu Gaigole", "112515109", "206"],
      [148, "Nachiket Shourya", "112516064", "206"],
      [149, "Ayush Singh", "112515069", "206"],
      [150, "Archit Adate", "112515045", "206"],
      [151, "Sriharsha", "112516043", "205"],
      [152, "Pushpak nandan", "112515290", "205"],
      [153, "Surya Ravikiran", "112515103", "205"],
      [154, "Sathwik varma", "112515073", "205"],
      [155, "Ramcharan", "112515277", "204"],
      [156, "Vinay Reddy", "112515302", "204"],
      [157, "Shashwat Jain", "112515264", "204"],
      [158, "hrushikesh more", "112516061", "204"],
      [159, "neel", "112516068", "203"],
      [160, "ruchit", "112515232", "203"],
      [161, "sahil", "112516087", "203"],
      [162, "swastik", "112515292", "203"],
      [163, "Pushp", "112515214", "202"],
      [164, "Priyanshu Jaiswal", "112515213", "202"],
      [165, "Abhishek Pagare", "112515014", "202"],
      [166, "Amarnath Gupta", "112515033", "202"],
      [167, "Sayan Majumdar", "112515255", "201"],
      [168, "Keshav Padia", "112516072", "201"],
      [169, "Arshith Kumar", "112515049", "201"],
      [170, "Anurag Sinha", "112515041", "201"],
    ]
  },
  // Page 7
  {
    page: 7,
    header: "Second Year Students Lists 2026-2027",
    rows: [
      [171, "Kunal Jangid", "112515132", "132"],
      [172, "Meanas Chiwande", "112515162", "132"],
      [173, "Naseem Khan", "112516046", "132"],
      [174, "Aziz Pitolwala", "112516021", "132"],
      [175, "Abhinav Yadav", "112515009", "131"],
      [176, "Akash Singh", "112515026", "131"],
      [177, "Nikhil Nayak", "112515188", "131"],
      [178, "Raman Patil", "112515222", "131"],
      [179, "Prakhar Mehta", "112515205", "130"],
      [180, "Abhishek Saini", "112515016", "130"],
      [181, "Saicharan", "112515107", "130"],
      [182, "Vedant chaple", "112515310", "129"],
      [183, "Piyush Patel", "112515201", "129"],
      [184, "Affaan Sheikh", "112515170", "129"],
      [185, "Nikhil J. Singh", "112515187", "129"],
      [186, "Siddhesh Umbarkar", "112515305", "128"],
      [187, "Abhishek kukade", "112515150", "128"],
      [188, "Prasad Shelke", "112515265", "128"],
      [189, "Vaibhav Gawade", "112515115", "128"],
      [190, "Nayan Raj", "112516067", "314"],
      [191, "Geetansh Seth", "112515116", "314"],
      [192, "aaryan", "112515004", "125"],
      [193, "divyanshu", "112515101", "125"],
      [194, "Dashank", "112515092", "124"],
      [195, "Shourya", "112515076", "124"],
      [196, "Chirasmith", "112515086", "124"],
      [197, "Soumya", "112515281", "123"],
      [198, "Hardik", "112516038", "123"],
    ]
  },
  // Page 8
  {
    page: 8,
    header: "Second Year Students Lists 2026-2027",
    rows: [
      [199, "Yug", "112515096", "123"],
      [200, "Harshit", "112515127", "123"],
      [201, "Namit Mourya", "112516066", "122"],
      [202, "Ankit Kumar Maurya", "112515040", "122"],
      [203, "Naman Shukla", "112516065", "122"],
      [204, "Om Prakash", "112515190", "122"],
      [205, "Vishal Katariya", "112516107", "121"],
      [206, "shalin nagar", "112515263", "121"],
      [207, "abhiraj jain", "112515010", "121"],
      [208, "Shaanit", "112515258", "121"],
      [209, "Ishan Banke", "112515131", "120"],
      [210, "Aditya Uikey", "112515023", "120"],
      [211, "Kshitij Kushwaha", "112515149", "120"],
      [212, "Harsh Sahibani", "112516040", "120"],
      [213, "Mehul Bhatia", "112515169", "119"],
      [214, "Chirayu Srivastav", "112515087", "119"],
      [215, "Abhishek Shete", "112515017", "119"],
      [216, "Chirag S R", "112515085", "119"],
      [217, "Suryanaraynan", "112516099", "118"],
      [218, "Sanidhya Raj", "112515243", "118"],
      [219, "G.Sathwik", "112515119", "118"],
      [220, "Pankaj Kumar", "112516074", "118"],
      [221, "Lakshya Lakhotiya", "112515152", "117"],
      [222, "Piyush Lokhande", "112516077", "117"],
      [223, "Piyush Kharoliya", "112516076", "117"],
      [224, "Abhinav Gupta", "112516004", "117"],
      [225, "Siddhant Bhaware", "112515077", "116"],
      [226, "Bhavishya Mahawar", "112515075", "116"],
      [227, "Pratham Sharde", "112515207", "116"],
    ]
  },
  // Page 9
  {
    page: 9,
    header: "Second Year Students Lists 2026-2027",
    rows: [
      [228, "Alvin Dsouza", "112515029", "116"],
      [229, "Mohan Krishna", "112515164", "115"],
      [230, "Medikunda Tarun", "112515163", "115"],
      [231, "Vikas", "112515095", "115"],
      [232, "Pranav", "112516073", "113"],
      [233, "Jemin", "112516060", "113"],
      [234, "Bhavesh", "112516062", "113"],
      [235, "Shubham", "112515274", "113"],
      [236, "Dnyanad", "112516032", "112"],
      [237, "Mehul", "112516055", "112"],
      [238, "Sushrut", "112516100", "112"],
      [239, "Anvay", "112515043", "112"],
      [240, "Rambhagat", "112515220", "111"],
      [241, "Samit Savanur", "112515238", "111"],
      [242, "Raj Yawale", "112515218", "111"],
      [243, "Gaurav Chaudhary", "112515112", "111"],
      [244, "Amit", "112516011", "110"],
      [245, "Rishu", "112515227", "110"],
      [246, "Yash Yadav", "112516109", "110"],
      [247, "Ayush Kumar", "112516019", "110"],
      [248, "Samyak Jain", "112515240", "109"],
      [249, "Krushang Mavapuri", "112515161", "109"],
      [250, "Tanuj Gopal", "112515296", "109"],
      [251, "Divyanshu Singh", "112516031", "109"],
      [252, "Ritul", "112515228", "108"],
      [253, "Vaibhav", "112516105", "108"],
      [254, "Prem Mehta", "112515168", "108"],
      [255, "Adhiraj Waghmare", "112515314", "108"],
    ]
  },
  // Page 10
  {
    page: 10,
    header: "Second Year Students Lists 2026-2027",
    rows: [
      [256, "Nikhil Asawa", "112515185", "107"],
      [257, "Harsh Yadav", "112515126", "107"],
      [258, "Saksham Bindal", "112515234", "107"],
      [259, "Aryan Sogani", "112516017", "107"],
      [260, "Gunjit", "112515124", "106"],
      [261, "Mahendar", "112515157", "106"],
      [262, "Ajay", "112516008", "106"],
      [263, "Priyanshu", "112516082", "106"],
      [264, "Parth Gupta", "112515194", "105"],
      [265, "Siddh Doshi", "112515102", "105"],
      [266, "Rohit Borana", "112515230", "105"],
      [267, "Aman Karanikale", "112516010", "105"],
      [268, "Ishan Srivastava", "112515130", "104"],
      [269, "Srijan Kumar", "112515282", "104"],
      [270, "Sarthak", "112516075", "104"],
      [271, "Raj", "112515217", "104"],
      [272, "Mrugank", "112515175", "103"],
      [273, "Sarthak", "112515249", "103"],
      [274, "Arjun", "112515047", "103"],
      [275, "Arya", "112515050", "103"],
      [276, "Ankur Shirsath", "112515267", "102"],
      [277, "Atharva Shinde", "112515266", "102"],
      [278, "Neelraje Patil", "112516069", "102"],
      [279, "Aditya Chaudhari", "112515021", "102"],
      [280, "Hanuman Dhakar", "112515125", "101"],
      [281, "Abhishek Bagra", "112515013", "101"],
      [282, "Dinesh", "112515099", "101"],
      [283, "Aman", "112515032", "101"],
    ]
  },
  // Page 11
  {
    page: 11,
    header: "Second Year Students Lists 2026-2027",
    rows: [
      [284, "Vignesh", "112516037", "30"],
      [285, "Pavan Kumar", "112515083", "30"],
      [286, "Vamshdeep", "112515159", "30"],
      [287, "N.siddu", "112516111", "30"],
      [288, "RAVINDRA KUMAR", "112515225", "30"],
      [289, "ABHIJIT JITENDRA MESHRAM", "112515008", "30"],
      [290, "Aditya Srivastava", "112516006", "29"],
      [291, "Kavya Srivastava", "112516045", "29"],
      [292, "KRISHAN KUMAR PRAJAPATI", "112516048", "29"],
      [293, "Nidheesh Agrawal", "112515184", "29"],
      [294, "mohit patil", "112515174", "28"],
      [295, "rishi rao", "112516084", "28"],
      [296, "vedant dhopate", "112515309", "28"],
      [297, "kshitij patil", "112516051", "28"],
      [298, "vivek mangal", "112515313", "27"],
      [299, "prafful pal", "112515203", "27"],
      [300, "sarthak shukla", "112515251", "27"],
      [301, "atharva sharma", "112515063", "27"],
      [302, "Harsh Padhiyar", "112515191", "26"],
      [303, "jash patel", "112515195", "26"],
      [304, "purva desai", "112515093", "26"],
      [305, "jitendra", "112516071", "26"],
      [306, "Nitin maurya", "112515189", "25"],
      [307, "piyush srivastava", "112515200", "25"],
      [308, "mehanshu patidar", "112515167", "25"],
      [309, "bhavesh patil", "112516023", "25"],
      [310, "Nayan Mahato", "112515067", "24"],
      [311, "Avinash Dubey", "112515183", "24"],
      [312, "Swapnil", "112515291", "15"],
    ]
  },
  // Page 12
  {
    page: 12,
    header: "Second Year Students Lists 2026-2027",
    rows: [
      [313, "Abhyuday", "112515018", "15"],
      [314, "Avi", "112515066", "15"],
      [315, "Gunasekhar", "112515089", "15"],
      [316, "DAKSH JAIN", "112515090", "2"],
      [317, "SUKHVEER", "112515287", "2"],
      [318, "TARUN AHUJA", "112516104", "2"],
      [319, "Amit Kumar", "112515035", "2"],
      [320, "SANIDHYA BHANDARI", "112516089", "316"],
      [321, "KANISHK HADA", "112516044", "315"],
      [322, "Rohan Dorale", "112415064", "316"],
      [323, "KRUNAL BHAVESHBHAI VASOYA", "112516050", ""], // Missing Room No
    ]
  },
  // Page 13
  {
    page: 13,
    header: "Students Nmae 2026-2027",
    rows: [
      [1, "MUNGAD SAUMYA KAMLESHKUMAR", "112515177", "115"],
      [2, "PRANAV VISHAWANATH BORKAR", "112516081", "228"],
      [3, "KONDAPALLY RAMCHARANTEJA", "112516047", "130"],
      [4, "MADHAV GADIYA", "222615008", "11"],
      [5, "GAUTAM RANJHAN", "222615006", "11"],
      [6, "GAUTAM SHARMA", "222615007", "18"],
      [7, "LAMIKANT", "222615009", "18"],
      [8, "PRANJAL BADE", "222615011", "18"],
      [9, "ADITYA KUMAR SINGH", "222615001", "19"],
      [10, "AKSHAY LANJEWAR", "222615002", "19"],
      [11, "HARSHAL SANGATHIYA", "222615012", "19"],
      [12, "ATHARV AYACHIT", "222615003", "19"],
      [13, "KRUSHAIL DANGAR", "222615005", "20"],
      [14, "VIVEK KUNAR", "222615015", "20"],
      [15, "RICKY KUMAR", "222515019", "30"],
    ]
  },
  // Page 14
  {
    page: 14,
    header: "Third Year Students Lists 2026-2027",
    rows: [
      [1, "Parth Rathod", "112415150", "301"],
      [2, "Rohit Thorat", "112415181", "301"],
      [3, "Akshad Sethi", "112415196", "301"],
      [4, "Pranav Zambare", "112415163", "301"],
      [5, "Madan Ram Sai Vuppala", "112415251", "302"],
      [6, "Abhiram Naluvala", "112415139", "302"],
      [7, "Peddolla Charan tej", "112415156", "302"],
      [8, "Yogeshwar Reddy", "112415254", "302"],
      [9, "Rudra Singhal", "112415184", "303"],
      [10, "Utkarsh Desale", "112415226", "303"],
      [11, "Milind Tomar", "112415131", "303"],
      [12, "Lavish Mangal", "112415115", "303"],
      [13, "Ajit Dangi", "112415014", "304"],
      [14, "Priyansh Agarwal", "112415169", "304"],
      [15, "Harsh Goswami", "112415249", "304"],
      [16, "Amol Raj", "112415018", "304"],
      [17, "Harsh Aghara", "112415076", "305"],
      [18, "Harkeerat singh", "112415075", "305"],
      [19, "Basant bansal", "112416017", "305"],
      [20, "Suraj Kumar", "112416068", "305"],
      [21, "Aadit Bajaj", "112415002", "306"],
      [22, "Hardik Jha", "112415074", "306"],
      [23, "Rayhan Sayed", "112415177", "306"],
      [24, "Pratham Bhardwaj", "112415165", "306"],
      [25, "Pranav Junnare", "112415162", "307"],
      [26, "Grandhi Lakshmikanth", "112416027", "307"],
      [27, "Jayanthi Venkata Sai Koushik", "112416033", "307"],
      [28, "Sandesh Shete", "112415192", "307"],
      [29, "Yeshwant sai", "112415250", "308"],
      [30, "Mohan", "112416044", "308"],
      [31, "Venkat P", "112415160", "308"],
      [32, "Rithvik", "112415059", "308"],
      [33, "Khushal Agrawal", "112416037", "309"],
      [34, "Aishwarya Yadav", "112416075", "309"],
      [35, "Meet Agrawal", "112415013", "309"],
      [36, "Rujul Jadage", "112415185", "309"],
      [37, "Meghraj Mahajan", "112415118", "310"],
      [38, "Om Khapekar", "112415102", "310"],
      [39, "Preetam Raj", "112416052", "310"],
    ]
  },
  // Page 15
  {
    page: 15,
    header: "Third Year Students Lists 2026-2027",
    rows: [
      [40, "Harsh Patel", "112415077", "310"],
      [41, "Pavan Kolhe", "112415104", "311"],
      [42, "Aniket Joshi", "112415091", "311"],
      [43, "Amit Vikram Tiwari", "112416005", "311"],
      [44, "Prerak Goyal", "112416053", "311"],
      [45, "Priyanshu negi", "112415171", "312"],
      [46, "Bibaswan pal", "112415047", "312"],
      [47, "Gautam joshi", "112415072", "312"],
      [48, "Ayush hotkar", "112415038", "312"],
      [49, "Jash Popat", "112415089", "317"],
      [50, "Manthan Vadi", "112416071", "317"],
      [51, "Kritgna Patel", "112416048", "317"],
      [52, "Krish Joshi", "112416039", "317"],
      [53, "Nishant Lad", "112415143", "318"],
      [54, "Nandan Appana", "112416007", "318"],
      [55, "Nagoor Merravali", "112416062", "318"],
      [56, "Sarvesh kumar kanth", "112416061", "318"],
      [57, "Abhinav Rathor", "112415006", "319"],
      [58, "Abhyankar Pratap Singh Chauhan", "112415007", "319"],
      [59, "Om Gajanan Patil", "112415145", "319"],
      [60, "Shivansh Prakashchandra Mishra", "112415205", "319"],
      [61, "Pratham kulkarni", "112415110", "320"],
      [62, "Devansh mittal", "112415058", "320"],
      [63, "Mayuresh Chavan", "112415127", "320"],
      [64, "Omkar pandit", "112415147", "320"],
      [65, "Krrish Swarnkar", "112415109", "321"],
      [66, "Aanoush Surana", "112415003", "321"],
      [67, "Vedant Tawari", "112415229", "321"],
      [68, "Ashutosh Raj Singh", "112415036", "321"],
      [69, "VIVEK KUMAR SINGH (PWD)", "112415238", "127"],
      [70, "Aryan Pulimoottil (PWD)", "112415172", "229"],
      [71, "Vedang Upendra Shende (Medical)", "112315171", "229"],
    ]
  }
];

// Analysis
let allStudents = [];
const rollSet = new Map();
const nameSet = new Map();
const roomOccupancy = new Map();

for (const p of pagesData) {
  for (const r of p.rows) {
    const student = {
      page: p.page,
      section: p.header,
      srNo: r[0],
      name: r[1],
      rollNo: r[2],
      roomNo: r[3],
    };
    allStudents.push(student);

    // Track room occupancy
    const roomKey = student.roomNo || "UNASSIGNED";
    if (!roomOccupancy.has(roomKey)) {
      roomOccupancy.set(roomKey, []);
    }
    roomOccupancy.get(roomKey).push(student);

    // Track duplicate rollNo
    if (rollSet.has(student.rollNo)) {
      console.warn("DUPLICATE ROLL NO:", student.rollNo, student.name, "vs", rollSet.get(student.rollNo));
    } else {
      rollSet.set(student.rollNo, student);
    }
  }
}

console.log("=== EXTRACTION SUMMARY ===");
console.log("Total entries in document:", allStudents.length);
console.log("Distinct MIS/Roll numbers:", rollSet.size);

// Group rooms by floor
const floorGroups = new Map();
for (const [room, occupants] of roomOccupancy.entries()) {
  let floor = "Unknown";
  if (room.startsWith("B")) {
    floor = "Basement / Ground Wing B";
  } else if (/^\d+$/.test(room)) {
    const num = parseInt(room, 10);
    if (num < 100) {
      floor = "Ground Floor (Numeric)";
    } else if (num >= 100 && num < 200) {
      floor = "Floor 1";
    } else if (num >= 200 && num < 300) {
      floor = "Floor 2";
    } else if (num >= 300 && num < 400) {
      floor = "Floor 3";
    }
  } else if (room === "UNASSIGNED") {
    floor = "Unassigned";
  }

  if (!floorGroups.has(floor)) floorGroups.set(floor, []);
  floorGroups.get(floor).push({ room, count: occupants.length, occupants });
}

console.log("\n=== FLOORS & ROOM BREAKDOWN ===");
for (const [floor, rooms] of floorGroups.entries()) {
  console.log(`\nFloor: ${floor} (${rooms.length} rooms)`);
  rooms.sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }));
  for (const r of rooms) {
    console.log(`  Room ${r.room.padEnd(6)}: ${r.count} student(s)${r.count > 4 ? " [OVER CAPACITY!]" : r.count < 4 ? " [UNDER CAPACITY]" : ""}`);
  }
}
