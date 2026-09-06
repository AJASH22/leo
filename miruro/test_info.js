    var HEADERS = { "User-Agent": "Mozilla/5.0" };
    async function test() {
        var res = await http_get("https://www.miruro.bz/info/21/one-piece", HEADERS);
        console.log("Status:", res.status);
        if (res.body) {
            var match = res.body.match(/<script id="__NEXT_DATA__".*?>(.*?)<\/script>/s);
            if (match) console.log("NextData size:", match[1].length);
            else console.log("No Next Data. Body size:", res.body.length);
        }
    }
    test();
