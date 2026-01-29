# AddrVal
USPS-based address validation server

## Usage
Just do a `GET /` to the server and receive address validation information. 
Auth is abstracted away by the server. This repo makes the USPS Addresses API
more accessible for James River Church's needs:
- Capability for proper CORS settings for our environment
- Server-side caching to be good stewards of the service we use

Parameters and response structure are the same as 
[the USPS API's `GET address/`](https://developers.usps.com/addressesv3).


## Environment variables
| Name                  | Type       | Description                                                                                        | Required? | Default                 |
| --------------------- | ---------- | -------------------------------------------------------------------------------------------------- | --------- | ----------------------- |
| `USPS_CLIENT_IDS`     | `string[]` | JSON-formatted array of USPS OAuth v2.0 client IDs with address                                    | Yes       |                         |
| `USPS_CLIENT_SECRETS` | `string[]` | JSON-formatted array of secrets in the same order as the client IDs                                | Yes       |                         |
| `ALLOW_ORIGIN`        | `string`   | Access-Control-Allow-Origin header value                                                           | Yes       |                         |
| `PORT`                | `int`      | Server port                                                                                        | No        | `10000`                 |
| `CACHE_COUNT`         | `int`      | Number of successful USPS responses to cache                                                       | No        | 50,000                  |
| `ALLOWED_IPS`         | `string[]` | JSON-formatted array of IP addresses (IPv4 and IPv6). Requests from all other IPs will be dropped. | No        | `[]` (All IP addresses) |
| `ENABLE_LOGGING`      | `bool`     | Log traffic statistics.                                                                            | No        | false                   |
