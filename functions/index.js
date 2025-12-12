const functions = require("firebase-functions");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require('firebase-admin');
const fs = require("fs");
const parser = require("epg-parser");
var dateFns = require('date-fns');
var fromUnixTime = require('date-fns/fromUnixTime');
var format = require('date-fns/format');
var parse = require('date-fns/parse');
var base64 = require('base-64');
var utf8 = require('utf8');
var isToday = require('date-fns/isToday');
var isTomorrow = require('date-fns/isTomorrow');
const https = require('https');
var zlib = require('zlib');
const ct = require('countries-and-timezones');
const shell = require('shelljs');

var serviceAccount = require("./tvnotify-b6a01-firebase-adminsdk-3e04k-42774239aa.json");
const { resolve } = require("path");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const storage = admin.storage()
db.settings({ ignoreUndefinedProperties: true })

exports.testCommitsPrograms = functions.https.onRequest((request, response) => {
    let url = "https://storage.googleapis.com/download/storage/v1/b/tvnotify-b6a01.appspot.com/o/guidatv.sky.it.xml?generation=1687943062634346&alt=media"
    downloadEPG(url, false)
                        .then(function (epg) {
                            return updateData("IT", epg)
                                .then(function (programs) {
                                    sendMessages("IT", programs)
                                        .then(function () {
                                            response.sendStatus(200)
                                        });
                                });

                        });
});

exports.testSendMessage = functions.https.onRequest((request, response) => {
    var programs = new Array();
    const programObject = {
        id: "QWxpZW46IENvdmVuYW50"
    }
    programs.push(programObject);
    return sendMessages("GB", programs)
                    .then(function () {
                            response.sendStatus(200)
                    });
});

exports.incrementPopularChannel = functions.https.onCall((data, context) => {

    const channelId = data.channelId;

    const refChannel = db.collection('channels').doc(channelId);
    return db.runTransaction(function (transaction) {
        return transaction.get(refChannel).then(function (doc) {

            if (!doc.exists) {
                return;
            }

            var counter = (doc.data().popular || 0) + 1;
            if (counter < 0) {
                counter = 0;
            }
            const counterData = {
                popular: counter
            };
            transaction.update(refChannel, { popular: counter });
            return;
        })
    });
});

exports.decrementPopularChannel = functions.https.onCall((data, context) => {

    const channelId = data.channelId;

    const refChannel = db.collection('channels').doc(channelId);
    return db.runTransaction(function (transaction) {
        return transaction.get(refChannel).then(function (doc) {

            if (!doc.exists) {
                return;
            }

            var counter = (doc.data().popular || 0) - 1;
            if (counter < 0) {
                counter = 0;
            }
            const counterData = {
                popular: counter
            };
            transaction.update(refChannel, { popular: counter });
        })
    });
});


exports.testPush = functions.https.onRequest((request, response) => {

    const pushPayload = {
        notification: {
            title: "[Debug] TVNotify",
            body: ' EPG Generator Success ✅'
        },
    };
    admin.messaging().sendToTopic('debug', pushPayload)
        .then((response) => {
            console.log('Successfully sent message:', response);
        })
        .catch((error) => {
            console.log('Error sending message:', error);
        });

    response.sendStatus(200);
});

function sendMessages(countryCode, programs) {
    return new Promise(function (resolve, reject) {
        var messages = [];
        const promises = [];
        index = 1;
        programs.forEach((program) => {
            const payload = {
                data: {
                    countryCode: countryCode,
                    programId: program.id,
                    macroTopic: "onUpdateProgram"
                },
                notification: {},
                topic: program.id,
                apns: {
                    payload: {
                        aps: {
                            contentAvailable: true,
                        },
                    },
                },
            };

            messages.push(payload);
            if (index == 499) {
                index = 1
                let messaging = admin.messaging().sendAll(messages)
                    .then((response) => {
                        //console.log('Successfully sent message:', response);
                    })
                    .catch((error) => {
                        console.error('Error sending message:', error.message);
                    });
                messages = [];
                promises.push(messaging);
            }
            index = index + 1;
        });

        if (messages.length > 0) {
            let messaging = admin.messaging().sendAll(messages)
                .then((response) => {
                    //console.log('Successfully sent message:', response);
                })
                .catch((error) => {
                    console.error('Error sending message:', error.message);
                });
            messages = [];
            promises.push(messaging);
        }

        Promise.all(promises).then(() =>
            console.log("send messages Completed")
        );
        resolve();
    });
}

function downloadEPG(url, unzip, response) {
    return new Promise(function (resolve, reject) {
        var req = https.get(url, function (response) {
            // on bad status, reject
            // on response data, cumulate it
            // on end, parse and resolve
            console.log("download Completed")

            if (unzip) {
                unzipEPG(response)
                    .then(function (epg) {
                        const result = parser.parse(epg);
                        console.log("Parser completed.");
                        resolve(result);
                    });
            } else {
                const stream = fs.createWriteStream("/tmp/epg.xml");
                response.pipe(stream);
                stream.on('finish', function () {
                    stream.close();
                    console.log("Write completed.");
                    const epg = fs.readFileSync("/tmp/epg.xml", { encoding: 'utf-8' });
                    const result = parser.parse(epg);
                    console.log("Parser completed.");
                    resolve(result);
                });

                stream.on('error', function (err) {
                    reject();
                });
            }
        });
        // on request error, reject
        // if there's post data, write it to the request
        // important: end the request req.end()
        req.end();
    });
}

function updateData(country, epg, programs) {
    return new Promise(async function (resolve, reject) {
        var promises = [];

        //channels

        var batch = db.batch()
        var channelsIdsWithPrograms = new Array();
        var allChannelsIds = new Array()
        let channelObjects = new Array();
        let channels = epg.channels;
        let channelsRef = db.collection("channels");
        channels.forEach((channel) => {
            //var bytes = utf8.encode(channel.id);
            var id = channel.id//base64.encode(bytes).split('.').join('').split('/').join('').split('=').join('');
            allChannelsIds.push(id);

            const channelObject = {
                id: id,
                name: channel.name[0].value,
                icon: channel.icon[0],
                url: channel.url[0],
                updated: admin.firestore.Timestamp.fromDate(new Date()),
                country: country
            }

            channelObjects.push(channelObject);
            let doc = channelsRef.doc(id);
            batch.set(doc, channelObject, { merge: true });
        });
        promises.push(batch.commit());
        console.log('commit channels')

        // programs

        batch = db.batch()
        let programs = new Array();

        var index = 0;
        epg.programs.forEach((program) => {
            var startDate = parse(program.start.split(' ')[0], 'yyyyMMddHHmmss', new Date());
            let start = admin.firestore.Timestamp.fromDate(startDate);
            var stopDate = parse(program.stop.split(' ')[0], 'yyyyMMddHHmmss', new Date());
            let stop = admin.firestore.Timestamp.fromDate(stopDate);
            let bytes = utf8.encode(program.title[0].value);
            let id = base64.encode(bytes).split('/').join('').split('=').join('');

            let existsProgramIndex = programs.findIndex(el => el.id == id);
            if (existsProgramIndex != -1) {
                var schedules = programs[existsProgramIndex].schedules;
                const schedule = {
                    start: start,
                    stop: stop,
                    episodeNum: program.episodeNum,
                    //desc: program.desc[0].value == undefined ? "" : program.desc[0].value,
                }
                schedules.push(schedule);
                programs[existsProgramIndex].schedules = schedules;
            } else {
                const schedule = {
                    start: start,
                    stop: stop,
                    episodeNum: program.episodeNum,
                    desc: program.desc.length > 0 ? program.desc[0].value : null
                }

                var schedules = new Array();
                schedules.push(schedule);

                //var encodedChannel = utf8.encode(program.channel);
                var channelId = program.channel//base64.encode(encodedChannel).split('.').join('').split('/').join('').split('=').join('');

                let channel = channelObjects.find(element => element.id == channelId);
                if (channelsIdsWithPrograms.find(element => element == channelId) == null) {
                    channelsIdsWithPrograms.push(channelId);
                }

                const programObject = {
                    id: id,
                    startDate: startDate,
                    start: start,
                    stop: stop,
                    channel: channel,
                    channelId: channel.id,
                    title: program.title[0].value,
                    searchTitle: program.title[0].value.toLowerCase(),
                    desc: program.desc.length > 0 ? program.desc[0].value : null,
                    categories: program.category,
                    episodeNum: program.episodeNum,
                    previouslyShown: program.previouslyShown,
                    credits: program.credits,
                    icon: program.icon[0],
                    schedules: schedules,
                    updated: admin.firestore.Timestamp.fromDate(new Date())
                }
                programs.push(programObject);
            }

            index = index + 1;
        });

        console.log("programs lenght: " + programs.length);

        let programsRef = db.collection("programs");
        let programsBatch = new Array();
        index = 1;
        programs.forEach((program) => {

            let doc = programsRef.doc(program.id);
            batch.set(doc, program, { merge: true });

            if (index == 499) {
                index = 1
                programsBatch.push(batch);
                //promises.push(batch.commit());
                batch = db.batch()
            }
            index = index + 1;
        });

        programsBatch.push(batch);
        /*
        programsBatch.forEach(async (batch) => {
            console.log('start batch.commit()')
            await batch.commit();
            console.log('finish batch.commit()')
        });
        */
        await Promise.all(programsBatch.map(batch => batch.commit()));

        //console.log('commit programs')

        //let channelsIdsWithoutPrograms = allChannelsIds.filter(id => !channelsIdsWithPrograms.includes(id));

        //Promise.all(promises).then(() =>
          //  console.log("update data Completed")
        //);

        console.log("update data Completed")
        resolve(programs);
    });
}

function unzipEPG(httpResponse, epg) {

    const sourcePath = "/tmp/epg.gz";
    const destinationPath = "/tmp/epg.xml";
    const gzFile = fs.createWriteStream(sourcePath);

    return new Promise(function (resolve, reject) {

        httpResponse.pipe(gzFile);

        gzFile.on("finish", () => {
            gzFile.close();
            if (gzFile.bytesWritten == 0) {
                reject();
            }

            try {
                // prepare streams
                var src = fs.createReadStream(sourcePath);
                var dest = fs.createWriteStream(destinationPath);

                // extract the archive 
                src.pipe(zlib.createGunzip()).pipe(dest);

                dest.on('close', function () {
                    const epg = fs.readFileSync(destinationPath, { encoding: 'utf-8' })
                    console.log("unzip Completed");
                    resolve(epg);
                });
            } catch (err) {
                reject();
            }
        });
    });
}

//ITA
exports.scheduledRunEPGGeneratorIT = onSchedule({
    schedule: '0 3 * * *',
    timeoutSeconds: 3600,
    memory: "2GB",
    timeZone: 'Europe/Rome'
}, async (event) => {
    let countryCode = 'IT';
    let site = 'guidatv.sky.it';
    return generateEPG(countryCode, site);
});


//GB

exports.scheduledRunEPGGeneratorUK = onSchedule({
    schedule: '0 3 * * *',
    timeoutSeconds: 3600,
    memory: "2GB",
    timeZone: 'Europe/Rome'
}, async (event) => {
    let countryCode = 'GB';
    let site = 'sky.com';
    return generateEPG(countryCode, site);
});


//FR
exports.scheduledRunEPGGeneratorFR = onSchedule({
    schedule: '0 3 * * *',
    timeoutSeconds: 3600,
    memory: "2GB",
    timeZone: 'Europe/Rome'
}, async (event) => {
    let countryCode = 'FR';
    let site = 'chaines-tv.orange.fr';
    return generateEPG(countryCode, site);
});



//ES
exports.scheduledRunEPGGeneratorES = onSchedule({
    schedule: '0 3 * * *',
    timeoutSeconds: 3600,
    memory: "2GB",
    timeZone: 'Europe/Rome'
}, async (event) => {
    let countryCode = 'ES';
    let site = 'movistarplus.es';
    return generateEPG(countryCode, site);
});


//DE
exports.scheduledRunEPGGeneratorDE = onSchedule({
    schedule: '0 3 * * *',
    timeoutSeconds: 3600,
    memory: "2GB",
    timeZone: 'Europe/Rome'
}, async (event) => {
    let countryCode = 'DE';
    let site = 'hd-plus.de';
    return generateEPG(countryCode, site);
});



//NL
exports.scheduledRunEPGGeneratorNL = onSchedule({
    schedule: '0 3 * * *',
    timeoutSeconds: 3600,
    memory: "2GB",
    timeZone: 'Europe/Rome'
}, async (event) => {
    let countryCode = 'NL';
    let site = 'delta.nl';
    return generateEPG(countryCode, site);
});




//SE
exports.scheduledRunEPGGeneratorSE = onSchedule({
    schedule: '0 3 * * *',
    timeoutSeconds: 3600,
    memory: "2GB",
    timeZone: 'Europe/Rome'
}, async (event) => {
    let countryCode = 'SE';
    let site = 'tv24.se';
    return generateEPG(countryCode, site);
});



//PL
exports.scheduledRunEPGGeneratorPL = onSchedule({
    schedule: '0 3 * * *',
    timeoutSeconds: 3600,
    memory: "2GB",
    timeZone: 'Europe/Rome'
}, async (event) => {

    let countryCode = 'PL';
    let site = 'programtv.onet.pl';
    return generateEPG(countryCode, site);
    
});


//CH
exports.scheduledRunEPGGeneratorCH = onSchedule({
    schedule: '0 3 * * *',
    timeoutSeconds: 3600,
    memory: "2GB",
    timeZone: 'Europe/Rome'
}, async (event) => {

    let countryCode = 'CH';
    let site = 'tv.blue.ch';
    return generateEPG(countryCode, site);
});

//US
exports.scheduledRunEPGGeneratorUS = onSchedule({
    schedule: '0 3 * * *',
    timeoutSeconds: 3600,
    memory: "2GB",
    timeZone: 'Europe/Rome'
}, async (event) => {

    let countryCode = 'US';
    let site = 'plex.tv';
    return generateEPG(countryCode, site);
});


exports.runGenerateEPGGB = onRequest({
    cors: true,
    timeoutSeconds: 3600,
    memory: "2GB"
}, (req, res) => {
    let countryCode = 'GB';
    let site = 'sky.com';
    return generateEPG(countryCode, site);
});


exports.runGenerateEPGFR = onRequest({
    cors: true,
    timeoutSeconds: 3600,
    memory: "2GB"
}, (req, res) => {
    let countryCode = 'FR';
    let site = 'chaines-tv.orange.fr';
    return generateEPG(countryCode, site);
});


exports.runGenerateEPGES = onRequest({
    cors: true,
    timeoutSeconds: 3600,
    memory: "2GB"
}, (req, res) => {
    let countryCode = 'ES';
    let site = 'movistarplus.es';
    return generateEPG(countryCode, site);
});


exports.runGenerateEPGDE = onRequest({
    cors: true,
    timeoutSeconds: 3600,
    memory: "2GB"
}, (req, res) => {
    let countryCode = 'DE';
    let site = 'hd-plus.de';
    return generateEPG(countryCode, site);
});


exports.runGenerateEPGNL = onRequest({
    cors: true,
    timeoutSeconds: 3600,
    memory: "2GB"
}, (req, res) => {
    let countryCode = 'NL';
    let site = 'delta.nl';
    return generateEPG(countryCode, site);
});



exports.runGenerateEPGSE = onRequest({
    cors: true,
    timeoutSeconds: 3600,
    memory: "2GB"
}, (req, res) => {
    let countryCode = 'SE';
    let site = 'tv24.se';
    return generateEPG(countryCode, site);
});


exports.runGenerateEPGPL = onRequest({
    cors: true,
    timeoutSeconds: 3600,
    memory: "2GB"
}, (req, res) => {
    let countryCode = 'PL';
    let site = 'programtv.onet.pl';
    return generateEPG(countryCode, site);
});


exports.runGenerateEPGCH = onRequest({
    cors: true,
    timeoutSeconds: 3600,
    memory: "2GB"
}, (req, res) => {
    let countryCode = 'CH';
    let site = 'tv.blue.ch';
    return generateEPG(countryCode, site);
});

exports.runGenerateEPGIT = onRequest({
    cors: true,
    timeoutSeconds: 3600,
    memory: "2GB"
}, (req, res) => {
    let countryCode = 'IT';
    let site = 'guidatv.sky.it';
    return generateEPG(countryCode, site);
});

exports.runGenerateEPGUS = onRequest({
    cors: true,
    timeoutSeconds: 3600,
    memory: "2GB"
}, (req, res) => {
    let countryCode = 'US';
    let site = 'plex.tv';
    return generateEPG(countryCode, site);
});

function generateEPG(countryCode, site) {
    return new Promise(function (resolve, reject) {
    console.log('pwd: ' + shell.pwd().toString());
    console.log('cd');
    shell.cd('epg');
    console.log('pwd: ' + shell.pwd().toString());

    let outputFile = '/tmp/' + site + '.xml';
    let exec = shell.exec('npx epg-grabber --config=sites/' + site + '/' + site + '.config.js --channels=sites/' + site + '/' + site + '.channels.xml --output=' + outputFile + ' --days=2')
    if (exec.code == 0) {

        shell.ls().forEach(function (file) {
            console.log(file)
        });

        let bucket = admin.storage().bucket('tvnotify-b6a01.appspot.com');
        const options = {
            predefinedAcl: 'publicRead',
            contentType: 'text/xml'
        };

        bucket.upload(outputFile, options).then(result => {
            console.log("File uploaded")
            const file = result[0];
            console.log("mediaLink: " + file.metadata.mediaLink)
            const object = {
                epgUrl: file.metadata.mediaLink,
                updated: admin.firestore.Timestamp.fromDate(new Date())
            };

            db.collection('countries')
                .doc(countryCode)
                .set(object, { merge: true })
                .then(() => {
                    const pushPayload = {
                        notification: {
                            title: "[Debug] TVNotify",
                            body: site + ' EPG Generator Success ✅'
                        },
                    };
                    admin.messaging().sendToTopic('debug', pushPayload)
                        .then((response) => {
                            console.log('Successfully sent message:', response);
                            
                        })
                        .catch((error) => {
                            console.log('Error sending message:', error);
                            
                        });

                    let needUnzip = false;
                    downloadEPG(file.metadata.mediaLink, needUnzip)
                        .then(function (epg) {
                            return updateData(countryCode, epg)
                                .then(function (programs) {
                                    sendMessages(countryCode, programs)
                                        .then(function () {
                                            resolve()
                                        });
                                });

                        });
                });

        }).catch(error => {
            console.error(error);
        });
    } else {
        const pushPayload = {
            notification: {
                title: "[Debug] TVNotify",
                body: site + ' EPG Generator Failed ❌'
            },
        };
        admin.messaging().sendToTopic('debug', pushPayload)
            .then((response) => {
                console.log('Successfully sent message:', response);
                resolve()
            })
            .catch((error) => {
                console.log('Error sending message:', error);
                resolve()
            });
    }
    });
}


//IT
// npx epg-grabber --config=sites/guidatv.sky.it/guidatv.sky.it.config.js --channels=sites/guidatv.sky.it/guidatv.sky.it.channels.xml --output=guidatv.sky.it.xml --days=3

//GB
// npx epg-grabber --config=sites/sky.com/sky.com.config.js --channels=sites/sky.com/sky.com.channels.xml --output=sky.com.xml --days=3

//FR
// npx epg-grabber --config=sites/chaines-tv.orange.fr/chaines-tv.orange.fr.config.js --channels=sites/chaines-tv.orange.fr/chaines-tv.orange.fr.channels.xml --output=chaines-tv.orange.fr.xml --days=3
// npx epg-grabber --config=sites/programme-tv.net/programme-tv.net.config.js --channels=sites/programme-tv.net/programme-tv.net.channels.xml --output=programme-tv.net.xml --days=3

//ES
// npx epg-grabber --config=sites/movistarplus.es/movistarplus.es.config.js --channels=sites/movistarplus.es/movistarplus.es.channels.xml --output=movistarplus.es.xml --days=3

//DE
// npx epg-grabber --config=sites/hd-plus.de/hd-plus.de.config.js --channels=sites/hd-plus.de/hd-plus.de.channels.xml --output=hd-plus.de.xml --days=3
// npx epg-grabber --config=sites/magentatv.de/magentatv.de.config.js --channels=sites/magentatv.de/magentatv.de.channels.xml --output=magentatv.de.xml --days=3

//NL
// npx epg-grabber --config=sites/delta.nl/delta.nl.config.js --channels=sites/delta.nl/delta.nl.channels.xml --output=delta.nl.xml --days=2
// npx epg-grabber --config=sites/tvgids.nl/tvgids.nl.config.js --channels=sites/tvgids.nl/tvgids.nl.channels.xml --output=tvgids.nl.xml --days=2 -> NON VA

//SE
// npx epg-grabber --config=sites/tv24.se/tv24.se.config.js --channels=sites/tv24.se/tv24.se.channels.xml --output=tv24.se.xml --days=2
// npx epg-grabber --config=sites/allente.se/allente.se.config.js --channels=sites/allente.se/allente.se.channels.xml --output=allente.se.xml --days=2 -> NON VA


//US
// npx epg-grabber --config=sites/tvtv.us/tvtv.us.config.js --channels=sites/tvtv.us/tvtv.us.channels.xml --output=tvtv.us.xml --days=2
// npx epg-grabber --config=sites/plex.tv/plex.tv.config.js --channels=sites/plex.tv/plex.tv.channels.xml --output=plex.tv.xml --days=2

//PL
// npx epg-grabber --config=sites/programtv.onet.pl/programtv.onet.pl.config.js --channels=sites/programtv.onet.pl/programtv.onet.pl.channels.xml --output=programtv.onet.pl.xml --days=2

//CH
// npx epg-grabber --config=sites/tv.blue.ch/tv.blue.ch.config.js --channels=sites/tv.blue.ch/tv.blue.ch.channels.xml --output=tv.blue.ch.xml --days=2