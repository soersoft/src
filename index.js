const patreonModule = require("patreon");
const { google } = require("googleapis");

const express = require("express");
const handlebars = require("express-handlebars");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const generateToken = require("./src/auth/generateToken");
const verifyToken = require("./src/auth/verifyToken");

const format = require("url").format;

const { patreon, oauth } = patreonModule;

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const app = express();

app.use(express.static("public"));
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5000", "https://src.seniorsoftwarevlogger.com"],
    credentials: true,
  })
);
app.use(cookieParser());
app.engine("handlebars", handlebars());
app.set("view engine", "handlebars");

const clientId = process.env.PATREON_CLIENT_ID;
const clientSecret = process.env.PATREON_CLIENT_SECRET;
const patreonRedirect =
  process.env.PATREON_REDIRECT_URL ||
  "http://localhost:5000/oauth/redirect/patreon";

const oauthClient = oauth(clientId, clientSecret);

const patreonUrl = format({
  protocol: "https",
  host: "patreon.com",
  pathname: "/oauth2/authorize",
  query: {
    response_type: "code",
    client_id: clientId,
    redirect_uri: patreonRedirect,
    state: "chill",
    scope: "identity[email]",
  },
});

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URL ||
    "http://localhost:5000/oauth/redirect/youtube"
);

const scopes = ["https://www.googleapis.com/auth/youtube"];

const googleUrl = oauth2Client.generateAuthUrl({
  access_type: "online",
  scope: scopes,
});

app.get("/", verifyToken, function (req, res) {
  let params = { user: req.user };

  if (req.user.patreon) {
    const apiClient = patreon(req.user.patreon.accessToken);

    apiClient("/current_user", {
      include: "memberships",
      fields: {
        user: "full_name,email,image_url,about",
        member:
          "patron_status,last_charge_status,last_charge_date,pledge_relationship_start",
      },
    })
      .then((userData) => {
        params.raw = JSON.stringify(userData.rawJson);
        console.dir(userData.rawJson);

        res.render("home", params);
      })
      .catch((err) => {
        console.log(err);
        res.redirect("/");
      });
  }

  if (req.user.youtube) {
    oauth2Client.setCredentials({
      access_token: req.user.youtube.accessToken,
    });

    google
      .youtube({ version: "v3", auth: oauth2Client })
      .channels.list({
        part: "snippet",
        mine: true,
      })
      .then((response) => {
        params.raw = JSON.stringify(response.data.items[0]);

        res.render("home", params);
      })
      .catch((err) => {
        console.log(err);
        res.redirect("/");
      });
  }
});

app.get("/login", function (req, res) {
  res.render("login", { patreonUrl, googleUrl });
});

app.get("/oauth/redirect/youtube", (req, res) => {
  const { code } = req.query;

  oauth2Client.getToken(code).then(({ tokens }) => {
    oauth2Client.setCredentials(tokens);

    google
      .youtube({ version: "v3", auth: oauth2Client })
      .channels.list({
        part: "snippet",
        mine: true,
      })
      .then((response) => {
        if (response.errors) {
          // The response structure is different in case of errors ¯\_(ツ)_/¯
          console.log(errors);
          // res.status(response.code);
        }

        // store JWT
        generateToken(res, {
          name: response.data.items[0].snippet.title,
          youtube: {
            accessToken: tokens.access_token,
            channelId: response.data.items[0].id,
          },
        });
        res.redirect("/");
      })
      .catch((err) => {
        console.log(err);
        res.redirect("/");
      });
  });
});

app.get("/oauth/redirect/patreon", (req, res) => {
  const { code } = req.query;

  return oauthClient
    .getTokens(code, patreonRedirect)
    .then(({ access_token }) => {
      const apiClient = patreon(access_token);

      return Promise.all([
        Promise.resolve(access_token),
        apiClient("/current_user", {
          include: "memberships",
          fields: {
            user: "full_name,email,image_url",
            member:
              "patron_status,last_charge_status,last_charge_date,pledge_relationship_start",
          },
        }),
      ]);
    })
    .then(([token, userData]) => {
      console.dir(userData.rawJson.data.relationships.campaign);

      generateToken(res, {
        name: userData.rawJson.data.attributes.full_name,
        patreon: {
          accessToken: token,
        },
      });

      return res.redirect("/");
    })
    .catch((err) => {
      console.log(err);
      console.log("Redirecting to login");
      res.redirect("/");
    });
});

app.get("/logout", (req, res) => {
  res.cookie("token", "", {
    expires: new Date(Date.now()),
    secure: process.env.DB_ENV === "production",
    httpOnly: true,
  });

  res.redirect("/");
});

const server = app.listen(process.env.PORT || 5000, () => {
  const { port } = server.address();
  console.log(`Listening on http:/localhost:${port}`);
});
