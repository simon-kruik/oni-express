var express = require('express');
var session = require('express-session');
var path = require('path');
var proxy = require('express-http-proxy');
var logger = require('morgan');
var bodyParser = require('body-parser');
var cors = require('cors');
var nocache = require('nocache');
var useragent = require('express-useragent');

const jwt = require('jwt-simple');
const sendEmail = require('./services/SendEmail')

var ocfl = require('./controllers/ocfl');
var check_jwt = require('./controllers/check_jwt');

var MemcachedStore = require("connect-memcached")(session);

var app = express();

var env = app.get('env');

var configFile = process.argv[2] || './config/express.json';
console.log('Using config file: ' + configFile);
var config = require(configFile)[env];

const {getVersion, getPortalConfig} = require('./controllers/config');
const indexer = require('./controllers/indexer');
const {verifyToken, simpleVerify} = require('./controllers/local_auth');
const { json } = require('body-parser');

const ocfl_path = config.ocfl.url_path || 'ocfl';

app.use(logger('dev'));

app.use(nocache());
app.use(useragent.express());
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.set('trust proxy', 1);

app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  store: new MemcachedStore({
    hosts: [config.session.server]
  }),
  cookie: {
    maxAge: config.session.expiry * 60 * 60 * 1000
  }

}));

if (config['cors']) {
  app.use(cors());
}

// checkSession: middleware which checks that the user is logged in and has
// values in their session which match what's expected in config.auth.allow.
//
// if the route is /jwt, let it through without checking (because this is the
// return URL from AAF)
// if the route is /, redirect to AAF if there's no session or uid

function checkSession(req, res, next) {
  console.log(`checkSession: ${req.url}`);
  if (config['clientBlock']) {
    const ua = req.useragent;
    for (cond of config['clientBlock']) {
      if (ua[cond]) {
        console.log(`client blocked ${cond}`);
        res.status(403).send("Browser or client not supported");
        return;
      }
    }
  }
  if (req.url === '/jwt/' || req.url === '/jwt' || config['auth']['UNSAFE_MODE']) {
    next();
  } else {
    const allow = config['auth']['allow'];
    if (!req.session || !req.session.uid) {
      if (req.url === '/') {
        res.redirect(303, config.auth.authURL);
      } else {
        res.status(403).send("Forbidden");
      }
    } else {
      var ok = true;
      for (field in allow) {
        if (!(field in req.session) || !req.session[field].match(allow[field])) {
          ok = false;
          console.log(`session check failed for ${field} ${req.session[field]}`);
        }
      }
      if (ok) {
        next();
      } else {
        req.status(403).send("Forbidden (this is from checkSession)");
      }
    }
  }
}

app.use(checkSession);

// authentication endpoint

app.post('/jwt', (req, res) => {

  const authjwt = jwt.decode(req.body['assertion'], config.auth.jwtSecret);
  if (check_jwt(config.auth, authjwt)) {
    console.log("AAF authentication was successful");
    const atts = authjwt[config.auth.attributes];
    req.session.uid = atts['mail'];
    req.session.displayName = atts['displayname'];
    req.session.affiliation = atts['edupersonscopedaffiliation'];
    res.redirect('/');
  } else {
    console.log("AAF authentication failed");
    res.sendStatus(403);
  }
});

app.post("/auth", (req, res) => {
});

app.get("/roi_register/:org",(req,res) => {
  req.session.roiRegistered = true;
  req.session.organisation = req.params.org;
  res.redirect('/');
});

app.post("/roi_register",(req,res) => {
  req.session.roiRegistered = true;
  const roi_info = req.body;
  if (config.email) {
    rego_data = {
      "access_key_id":config.email.access_key_id,
      "secret_access_key":config.email.secret_access_key,
      "region":config.email.region,
      "source_email":config.email.source_email,
      "template":config.email.email_templates.roi.name,
      "dest_emails":config.email.dest_emails
    }
    rego_data["template_data"] = JSON.stringify({"oni_portal_name":config.email.oni_portal_name, "roi_content":roi_info});
    console.log("Registration received: " + JSON.stringify(roi_info));
    console.log("Sending email with info to: " + rego_data["dest_emails"]);
    access_data = {
      "access_key_id":config.email.access_key_id,
      "secret_access_key":config.email.secret_access_key,
      "region":config.email.region,
      "source_email":config.email.source_email,
      "template":config.email.email_templates.roi_access.name,
      "dest_emails":[roi_info["contact"]]
    }
    access_data["template_data"] = JSON.stringify({"oni_portal_name":config.email.oni_portal_name, "roi_inst_name":roi_info["inst"], "oni_portal_url":"http://" + req.get('host')});

    sendEmail(rego_data);
    sendEmail(access_data);
  }
  else {
    console.error("Attempted to register interest, but no email configured");
  }
  //res.status(200).send(roi_info);
  // TODO: Record/email the registration info
  // Email Data Manager the ROI Info
  // Email Contact Address a link to /roi_register/req.params.inst
  res.redirect('/');
  
});


app.get('/config/portal', async (req, res) => {
  try {
    const portalConfig = await getPortalConfig({indexer: config['indexer'], express: config, base: config['portal']});
    res.status(200).json(portalConfig);
  } catch (e) {
    res.status(500).json({error: e});
  }
});
//Attach to an event listener

app.get('/config/index/run', verifyToken, async (req, res) => {
  try {
    const authorized = await simpleVerify(config.api, req.token);
    if (authorized) {
      await indexer.index({indexer: config['indexer']});
      res.status(200).json({status: 'indexed: commit to solr'});
    } else {
      res.status(403).json({error: 'incorrect token, not authorized'});
    }
  } catch (e) {
    res.status(500).json({error: e});
  }
});

app.get('/config/status', async (req, res) => {
  try {
    let error = false;
    const status = {}
    status.config = {
      express: configFile,
      portal: config.portal,
      indexer: config.indexer,
    }
    status.version = await getVersion();
    const solrStatus = await indexer.solrStatus(config);
    if (solrStatus.error) {
      error = true;
    }
    status.solrStatus = solrStatus;
    const solrCheck = await indexer.checkSolr({indexer: config['indexer']}, 1);
    status.solrCheck = solrCheck;
    if(solrCheck.error){
      status.error = true;
    }
    const ts = new Date();
    status.serverTime = ts.toLocaleString();
    if (error) {
      res.status(500).json(status);
    } else {
      res.status(200).json(status);
    }
  } catch (e) {
    logger.error(e);
    res.status(500).json({error: e});
  }
})
// ocfl-express endpoints

app.get(`/${ocfl_path}/`, async (req, res) => {
  console.log(`/ocfl/ Session id: ${req.session.id}`);
  // if( !req.session.uid ) {
  // 	console.log("/ocfl/repo endpoint: no uid in session");
  //   	res.status(403).send("Forbidden");
  //   	return;
  // }
  if (config.ocfl.autoindex) {
    const index = await ocfl.index(config, req.params.repo, req.query);
    res.send(index);
  } else {
    console.log("Repository indexing is not configured");
    res.status(404).send("Repository index is not configured");
  }
});

// fixme: make cache-control no-store

app.get(`/${ocfl_path}/:oidv/:content*?`, async (req, res) => {
  // console.log(`/ocfl/ Session id: ${req.session.id}`);
  // console.log(`ocfl: session = ${req.session.uid}`);
  // if( !req.session.uid ) {
  // 	console.log("/ocfl/repo/oid: no uid found in session");
  //  	res.status(403).send("Forbidden");
  //   	return;
  // }

  // TODO: Add a check here for whether Registration of Interest is required
  // and if it exists in the session
  console.log("ROI Required value:");
  console.log(config.ocfl.roi_required);

  if (config.ocfl.roi_required) {
    if (!req.session || !req.session.roiRegistered) {
      if (config.ocfl.roiURL) {
        res.redirect(303, config.ocfl.roiURL);
      }
      else {
        res.status(403).send("Please register your interest before downloading data");
      }
    }
  }

  if (config.ocfl.referrer && req.headers['referer'] !== config.ocfl.referrer) {
    console.log(`Request referrer ${req.headers['referer']} does not match ${config.ocfl.referrer}`);
    res.status(403).send("Forbidden");
  } else {
    console.log(`ocfl get: ${JSON.stringify(req.params)}`);
    var content = req.params.content;
    if (req.params[0]) {
      content += req.params[0];
    }
    var oidparts = req.params.oidv.split('.v');
    var oid = oidparts[0];
    var v = (oidparts.length === 2) ? 'v' + oidparts[1] : '';

    console.log(`ocfl get: oid ${oid} v ${v} content ${content}`);

    if (!content || content.slice(-1) === '/') {
      if (config.ocfl.index_file) {
        const index_file = content ? content + config.ocfl.index_file : config.ocfl.index_file;
        const file = await ocfl.file(config, oid, v, index_file);
        if (file) {
          res.sendFile(file);
          return;
        }
        // if the index_file is not found, fall through to autoindex if
        // it's configured
      }
      if (config.ocfl.autoindex) {
        const index = await ocfl.index(config, req.query, oid, v, content);
        if (index) {
          res.send(index);
        } else {
          res.status(404).send("Not found");
        }
      } else {
        console.log("Autoindex not available");
        res.status(404).send("Autoindex is not available");
      }
    } else {
      const file = await ocfl.file(config, oid, v, content);
      if (file) {
        res.sendFile(file);
      } else {
        res.status(404).send("Not found");
      }
    }
  }
});

// solr proxy - only allows select queries

app.use('/solr/ocfl/select*', proxy(config['solr'], {
  filter: (req, res) => {

    // if( ! req.session.uid ) {
    // console.log("/solr/ocfl/ No iud found in session");
    // 	return false;
    // }
    if (req.method !== 'GET') {
      return false;
    }
    return true;
  },
  proxyReqPathResolver: (req) => {
    if (config['solr_fl']) {
      return req.originalUrl + '&fl=' + config['solr_fl'].join(',')
    } else {
      return req.originalUrl;
    }
  }
}));

// data portal front page

app.use('/', express.static(path.join(__dirname, 'portal')));

// Bootstrap Section
(async () => {
  await indexer.buildSchema({indexer: config['indexer']});
})();

module.exports = app;
