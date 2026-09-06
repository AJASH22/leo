    var HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0" };
    async function test() {
        var res = await http_get("https://www.miruro.bz/", HEADERS);
        console.log("Status:", res.status);
        console.log(res.body ? res.body.substring(0, 200) : "no body");
    }
    test();
