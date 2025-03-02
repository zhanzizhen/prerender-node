var request = require('request')
  , url = require('url')
  , zlib = require('zlib');

var prerender = module.exports = function(req, res, next) {
  if(!prerender.shouldShowPrerenderedPage(req)) return next();

  prerender.beforeRenderFn(req, function(err, cachedRender) {

    if (!err && cachedRender) {
      if (typeof cachedRender == 'string') {
        res.writeHead(200, {
          "Content-Type": "text/html"
        });
        return res.end(cachedRender);
      } else if (typeof cachedRender == 'object') {
        res.writeHead(cachedRender.status || 200, {
          "Content-Type": "text/html"
        });
        return res.end(cachedRender.body || '');
      }
    }

    prerender.getPrerenderedPageResponse(req, function(err, prerenderedResponse){
      prerender.afterRenderFn(err, req, prerenderedResponse);

      if(prerenderedResponse){
        res.writeHead(prerenderedResponse.statusCode, prerenderedResponse.headers);
        return res.end(prerenderedResponse.body);
      } else {
        next(err);
      }
    });
  });
};

prerender.whitelist=[];
prerender.blacklisted=[];
prerender.crawlerUserAgents = [
  'googlebot', 
  'yahoo! slurp', 
  'bingbot', 
  'yandex', 
  'baiduspider', 
  'facebookexternalhit', 
  'twitterbot', 
  'rogerbot', 
  'linkedinbot', 
  'embedly', 
  'quora link preview', 
  'showyoubot', 
  'outbrain', 
  'pinterest/0.', 
  'developers.google.com/+/web/snippet', 
  'slackbot', 
  'vkshare', 
  'w3c_validator', 
  'redditbot', 
  'applebot', 
  'whatsapp', 
  'flipboard', 
  'tumblr', 
  'bitlybot', 
  'skypeuripreview', 
  'nuzzel', 
  'discordbot', 
  'google page speed', 
  'qwantify', 
  'pinterestbot', 
  'bitrix link preview', 
  'xing-contenttabreceiver', 
  'chrome-lighthouse'
];


prerender.extensionsToIgnore = [
  '.js',
  '.css',
  '.xml',
  '.less',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.pdf',
  '.doc',
  '.txt',
  '.ico',
  '.rss',
  '.zip',
  '.mp3',
  '.rar',
  '.exe',
  '.wmv',
  '.doc',
  '.avi',
  '.ppt',
  '.mpg',
  '.mpeg',
  '.tif',
  '.wav',
  '.mov',
  '.psd',
  '.ai',
  '.xls',
  '.mp4',
  '.m4a',
  '.swf',
  '.dat',
  '.dmg',
  '.iso',
  '.flv',
  '.m4v',
  '.torrent',
  '.woff',
  '.ttf',
  '.svg',
  '.webmanifest'
];

prerender.whitelisted = function(whitelist) {
  if(!whitelist instanceof Array){
    throw new TypeError('Expected whitelist to be an array')
  }
  prerender.whitelist = whitelist;
  return this;
};

prerender.blacklisted = function(blacklist) {
  if(!blacklist instanceof Array){
    throw new TypeError('Expected blacklist to be an array')
  }
  prerender.blacklist = blacklist;
  return this;
};


prerender.shouldShowPrerenderedPage = function(req) {
  var userAgent = req.headers['user-agent']
    , bufferAgent = req.headers['x-bufferbot'];

  if(!userAgent) return false; // it is not a bot
  if(req.method !== 'GET' && req.method !== 'HEAD') return false;
  if(req.headers && req.headers['x-prerender']) return false;

  //if it is a bot and is requesting a resource...dont prerender
  if(prerender.extensionsToIgnore.some(function(extension){return req.url.toLowerCase().indexOf(extension) !== -1;})) return false;

  //if it is a bot and not requesting a resource and is not whitelisted...dont prerender
  if(this.whitelist.every(function(whitelisted){return (new RegExp(whitelisted)).test(req.url) === false;})) return false;

  //if it is a bot and not requesting a resource and is not blacklisted(url or referer)...dont prerender
  if(this.blacklist.some(function(blacklisted){
    var blacklistedUrl = false
      , blacklistedReferer = false
      , regex = new RegExp(blacklisted);

    blacklistedUrl = regex.test(req.url) === true;
    if(req.headers['referer']) blacklistedReferer = regex.test(req.headers['referer']) === true;

    return blacklistedUrl || blacklistedReferer;
  })) return false;

  //if it contains _escaped_fragment_, show prerendered page
  var parsedQuery = url.parse(req.url, true).query;
  if(parsedQuery && parsedQuery['_escaped_fragment_'] !== undefined) return true;

  //if it is a bot...show prerendered page
  if(prerender.crawlerUserAgents.some(function(crawlerUserAgent){ return userAgent.toLowerCase().indexOf(crawlerUserAgent) !== -1;})) return true;

  //if it is BufferBot...show prerendered page
  if(bufferAgent) return true;

  return false;
};


prerender.prerenderServerRequestOptions = {};

prerender.getPrerenderedPageResponse = function(req, callback) {
  var options = {
    uri: url.parse(prerender.buildApiUrl(req)),
    followRedirect: false,
    headers: {}
  };
  for (var attrname in this.prerenderServerRequestOptions) { options[attrname] = this.prerenderServerRequestOptions[attrname]; }
  if (this.forwardHeaders === true) {
    Object.keys(req.headers).forEach(function(h) {
      // Forwarding the host header can cause issues with server platforms that require it to match the URL
      if (h == 'host') {
        return;
      }
      options.headers[h] = req.headers[h];
    });
  }
  options.headers['User-Agent'] = req.headers['user-agent'];
  options.headers['Accept-Encoding'] = 'gzip';
  if(this.prerenderToken || process.env.PRERENDER_TOKEN) {
    options.headers['X-Prerender-Token'] = this.prerenderToken || process.env.PRERENDER_TOKEN;
  }

  request.get(options).on('response', function(response) {
    if(response.headers['content-encoding'] && response.headers['content-encoding'] === 'gzip') {
      prerender.gunzipResponse(response, callback);
    } else {
      prerender.plainResponse(response, callback);
    }
  }).on('error', function(err) {
    callback(err);
  });
};

prerender.gunzipResponse = function(response, callback) {
  var gunzip = zlib.createGunzip()
    , content = '';

  gunzip.on('data', function(chunk) {
    content += chunk;
  });
  gunzip.on('end', function() {
    response.body = content;
    delete response.headers['content-encoding'];
    delete response.headers['content-length'];
    callback(null, response);
  });
  gunzip.on('error', function(err){
    callback(err);
  });

  response.pipe(gunzip);
};

prerender.plainResponse = function(response, callback) {
  var content = '';

  response.on('data', function(chunk) {
    content += chunk;
  });
  response.on('end', function() {
    response.body = content;
    callback(null, response);
  });
};


prerender.buildApiUrl = function(req) {
  var prerenderUrl = prerender.getPrerenderServiceUrl();
  var forwardSlash = prerenderUrl.indexOf('/', prerenderUrl.length - 1) !== -1 ? '' : '/';

  var protocol = req.connection.encrypted ? "https" : "http";
  if (req.headers['cf-visitor']) {
    var match = req.headers['cf-visitor'].match(/"scheme":"(http|https)"/);
    if (match) protocol = match[1];
  }
  if (req.headers['x-forwarded-proto']) {
    protocol = req.headers['x-forwarded-proto'].split(',')[0];
  }
  if (this.protocol) {
    protocol = this.protocol;
  }
  var fullUrl = protocol + "://" + (this.host || req.headers['x-forwarded-host'] || req.headers['host']) + req.url;
  return prerenderUrl + forwardSlash + fullUrl;
};

prerender.getPrerenderServiceUrl = function() {
  return this.prerenderServiceUrl || process.env.PRERENDER_SERVICE_URL || 'https://service.prerender.io/';
};

prerender.beforeRenderFn = function(req, done) {
  if (!this.beforeRender) return done();

  return this.beforeRender(req, done);
};


prerender.afterRenderFn = function(err, req, prerender_res) {
  if (!this.afterRender) return;

  this.afterRender(err, req, prerender_res);
};


prerender.set = function(name, value) {
  this[name] = value;
  return this;
};
