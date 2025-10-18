# index_en | mineru readme

原文链接: https://mineru.net/doc/docs/index_en.html?theme=dark&v=1.0#single-file-parsing

On this page

# index\_en

## Single File Parsing[​](#single-file-parsing "Direct link to Single File Parsing")

### Creating a Parsing Task[​](#creating-a-parsing-task "Direct link to Creating a Parsing Task")

#### Interface Description[​](#interface-description "Direct link to Interface Description")

Applicable to scenarios where a parsing task is created via an API. Users must first obtain a Token.

**Note:**

* The size of a single file cannot exceed 200MB, and the number of pages must not exceed 600.
* Each account is entitled to a maximum quota of 2000 pages per day at the highest priority for parsing. Pages exceeding 2000 will have reduced priority.
* Due to network restrictions, URLs hosted on GitHub, AWS, etc., may time out when requested.
* This API does not support direct file upload
* The header must contain an Authorization field in the format: Bearer + space + Token

#### Python Request Example[​](#python-request-example "Direct link to Python Request Example")

```
import requests  
  
token = "***"  
url = "https://mineru.net/api/v4/extract/task"  
header = {  
    "Content-Type": "application/json",  
    "Authorization": f"Bearer {token}"  
}  
data = {  
    "url": "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",  
    "is_ocr": True,  
    "enable_formula": False,  
}  
  
res = requests.post(url,headers=header,json=data)  
print(res.status_code)  
print(res.json())  
print(res.json()["data"])
```

#### CURL Request Example[​](#curl-request-example "Direct link to CURL Request Example")

```
curl --location --request POST 'https://mineru.net/api/v4/extract/task' \  
--header 'Authorization: Bearer ***' \  
--header 'Content-Type: application/json' \  
--header 'Accept: */*' \  
--data-raw '{  
    "url": "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",  
    "is_ocr": true,  
    "enable_formula": false  
}'
```

#### Request Body Parameters[​](#request-body-parameters "Direct link to Request Body Parameters")

| Parameter | Type | Required | Example | Description |
| --- | --- | --- | --- | --- |
| url | string | Yes | `https://static.openxlab.org.cn` `/opendatalab/pdf/demo.pdf` | File URL,support:.pdf, .doc, .docx, .ppt, .pptx, .png, .jpg, .jpeg |
| is\_ocr | bool | No | `false` | Whether to enable OCR functionality. Default is `false`. |
| enable\_formula | bool | No | `true` | Whether to enable formula recognition. Default is `true`. |
| enable\_table | bool | No | `true` | Whether to enable table recognition. Default is `true`. |
| language | string | No | `ch` | Specify the document language, default is ​ch (Chinese). For other optional values, refer to the list of supported languages: [PaddleOCR Multi Languages](https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html#4-supported-languages-and-abbreviations). |
| data\_id | string | No | `abc**` | The data ID corresponding to the parsing object. It consists of uppercase and lowercase English letters, digits, underscores (`_`), hyphens (`-`), and periods (`.`), and does not exceed 128 characters. It can be used to uniquely identify your business data. |
| callback | string | No | `http://127.0.0.1/callback` | The URL for callback notifications of the parsing result, supporting HTTP and HTTPS protocols. If this field is empty, you must regularly poll for the parsing result. The callback interface must support the POST method, UTF-8 encoding, and `Content-Type: application/json` for data transmission, as well as the parameters `checksum` and `content`. The parsing interface sets `checksum` and `content` according to the following rules and formats, then calls your callback interface to return the detection results. **checksum**: A string formatted as the user’s `uid` + `seed` + `content` concatenated, generated via the SHA256 algorithm. You can find your user `UID` in the user center. To prevent tampering, you can generate this string upon receiving the pushed result and compare it with `checksum` for verification. **content**: A JSON string; please parse and convert it back into a JSON object yourself. For an example of the `content` result, see the return example of the task query result, corresponding to the `data` part of the task query result. **Note**: When your server’s callback interface receives the results pushed by the Mineru parsing service, if the HTTP status code returned is `200`, it indicates successful reception; any other HTTP status code is regarded as a reception failure. In case of failure, the Mineru service will attempt to push the results up to `5` times until successfully received. If still not successful after `5` attempts, it will stop pushing. We suggest you check the status of your callback interface. |
| seed | string | No | `abc**` | A random string used for the signature in the callback notification. It consists of English letters, digits, and underscores (`_`), and does not exceed 64 characters. Defined by you, it is used to verify that the request was initiated by the Mineru parsing service when receiving the content security callback notification. **Note**: This field must be provided when using callback. |
| extra\_formats | [string] | No | ["docx","html"] | markdown and json are default export formats (do not need to be set), this parameter only supports one or multiple formats from: docx, html, latex |
| page\_ranges | string | No | 1-600 | Specifies a page range as a comma-separated string. Examples include 2,4-6 which selects pages [2,4,5,6] and 2 - -2 which selects all pages starting with the second page and ending with the next-to-last page (specified by -2) |
| model\_version | string | No | vlm | mineru model version; options: pipeline or vlm, default is pipeline. |

#### Request Body Example[​](#request-body-example "Direct link to Request Body Example")

```
{  
  "url": "https://static.openxlab.org.cn/opendatalab/pdf/demo.pdf",  
  "is_ocr": true,  
  "data_id": "abcd"  
}
```

#### Response Parameters[​](#response-parameters "Direct link to Response Parameters")

| Parameter | Type | Example | Description |
| --- | --- | --- | --- |
| code | int | `0` | API status code. Success: `0` |
| msg | string | `ok` | API processing message. Success: `"ok"` |
| trace\_id | string | `c876cd60b202f2396de1f9e39a1b0172` | Request ID |
| data.task\_id | string | `a90e6ab6-44f3-4554-b459-b62fe4c6b436` | Extraction task ID, can be used to query task results |

#### Response Example[​](#response-example "Direct link to Response Example")

```
{  
  "code": 0,  
  "data": {  
    "task_id": "a90e6ab6-44f3-4554-b4***"  
  },  
  "msg": "ok",  
  "trace_id": "c876cd60b202f2396de1f9e39a1b0172"  
}
```

### Retrieve Task Results[​](#retrieve-task-results "Direct link to Retrieve Task Results")

#### Interface Description[​](#interface-description-1 "Direct link to Interface Description")

Use `task_id` to query the current progress of the extraction task. After the task is completed, the interface will respond with the corresponding extraction details.

#### Python Request Example[​](#python-request-example-1 "Direct link to Python Request Example")

```
import requests  
  
token = "***"  
url = f"https://mineru.net/api/v4/extract/task/{task_id}"  
header = {  
    "Content-Type": "application/json",  
    "Authorization": f"Bearer {token}"  
}  
  
res = requests.get(url, headers=header)  
print(res.status_code)  
print(res.json())  
print(res.json()["data"])
```

#### CURL Response Example[​](#curl-response-example "Direct link to CURL Response Example")

```
curl --location --request GET 'https://mineru.net/api/v4/extract/task/{task_id}' \  
--header 'Authorization: Bearer *****' \  
--header 'Accept: */*'
```

#### Response Parameters[​](#response-parameters-1 "Direct link to Response Parameters")

| Parameter | Type | Example | Description |
| --- | --- | --- | --- |
| code | int | `0` | API status code. Success: `0` |
| msg | string | `ok` | API processing message. Success: `"ok"` |
| trace\_id | string | `c876cd60b202f2396de1f9e39a1b0172` | Request ID |
| data.task\_id | string | `abc**` | Task ID |
| data.data\_id | string | `abc**` | The data ID corresponding to the parsing object. **Note**: If `data_id` was passed in the parsing request parameters, it will return the corresponding `data_id` here. |
| data.state | string | `done` | Task processing status: `done` (completed), `pending` (in queue), `running` (being parsed), `failed` (parsing failed),`converting`(format converting) |
| data.full\_zip\_url | string | `https://cdn-mineru.openxlab.org.cn/pdf/018e53ad-d4f1-475d-b380-36bf24db9914.zip` | The compressed package of the file parsing result |
| data.err\_msg | string | `The file format is not supported. Please upload a file of the required type.` | Reason for parsing failure; valid when `state=failed` |
| data.extract\_progress.extracted\_pages | int | 1 | Number of pages parsed, valid when state=running |
| data.extract\_progress.start\_time | string | 2025-01-20 11:43:20 | Document parsing start time, valid when state=running |
| data.extract\_progress.total\_pages | int | 2 | Total number of pages in document, valid when state=running |

#### Response Example[​](#response-example-1 "Direct link to Response Example")

```
{  
  "code": 0,  
  "data": {  
    "task_id": "47726b6e-46ca-4bb9-******",  
    "state": "running",  
    "err_msg": "",  
    "extract_progress": {  
      "extracted_pages": 1,  
      "total_pages": 2,  
      "start_time": "2025-01-20 11:43:20"  
    }  
  },  
  "msg": "ok",  
  "trace_id": "c876cd60b202f2396de1f9e39a1b0172"  
}
```

```
{  
  "code": 0,  
  "data": {  
    "task_id": "47726b6e-46ca-4bb9-******",  
    "state": "done",  
    "full_zip_url": "https://cdn-mineru.openxlab.org.cn/pdf/018e53ad-d4f1-475d-b380-36bf24db9914.zip",  
    "err_msg": ""  
  },  
  "msg": "ok",  
  "trace_id": "c876cd60b202f2396de1f9e39a1b0172"  
}
```

## Batch File Parsing[​](#batch-file-parsing "Direct link to Batch File Parsing")

### Batch File Upload and Parsing[​](#batch-file-upload-and-parsing "Direct link to Batch File Upload and Parsing")

#### Interface Description[​](#interface-description-2 "Direct link to Interface Description")

Applicable to scenarios where local files are uploaded for parsing. You can request multiple file upload URLs through this interface, and after uploading the files, the system will automatically submit parsing tasks.

**Note:**

* The requested file upload URLs are valid for 24 hours. Please complete the file upload within this period.
* When uploading files, there is no need to set the `Content-Type` request header.
* After uploading the files, there is no need to call the submit parsing task interface. The system will automatically scan the successfully uploaded files and submit parsing tasks.
* You cannot request more than 200 links at once.
* The header must contain an Authorization field in the format: Bearer + space + Token

#### Python Request Example[​](#python-request-example-2 "Direct link to Python Request Example")

```
import requests  
  
token = "***"  
url = "https://mineru.net/api/v4/file-urls/batch"  
header = {  
    "Content-Type": "application/json",  
    "Authorization": f"Bearer {token}"  
}  
data = {  
    "enable_formula": True,  
    "language": "ch",  
    "enable_table": True,  
    "files": [  
        {"name":"demo.pdf", "is_ocr": True, "data_id": "abcd"}  
    ]  
}  
file_path = ["demo.pdf"]  
try:  
    response = requests.post(url,headers=header,json=data)  
    if response.status_code == 200:  
        result = response.json()  
        print('response success. result:{}'.format(result))  
        if result["code"] == 0:  
            batch_id = result["data"]["batch_id"]  
            urls = result["data"]["file_urls"]  
            print('batch_id:{},urls:{}'.format(batch_id, urls))  
            for i in range(0, len(urls)):  
                with open(file_path[i], 'rb') as f:  
                    res_upload = requests.put(urls[i], data=f)  
                    if res_upload.status_code == 200:  
                        print(f"{urls[i]} upload success")  
                    else:  
                        print(f"{urls[i]} upload failed")  
        else:  
            print('apply upload url failed,reason:{}'.format(result.msg))  
    else:  
        print('response not success. status:{} ,result:{}'.format(response.status_code, response))  
except Exception as err:  
    print(err)
```

#### CURL Response Example[​](#curl-response-example-1 "Direct link to CURL Response Example")

```
curl --location --request POST 'https://mineru.net/api/v4/file-urls/batch' \  
--header 'Authorization: Bearer ***' \  
--header 'Content-Type: application/json' \  
--header 'Accept: */*' \  
--data-raw '{  
    "enable_formula": true,  
    "language": "ch",  
    "enable_table": true,  
    "files": [  
        {"name":"demo.pdf", "is_ocr": true, "data_id": "abcd"}  
    ]  
}'
```

#### CURL File Uploading Example[​](#curl-file-uploading-example "Direct link to CURL File Uploading Example")

```
curl -X PUT -T /path/to/your/file.pdf 'https://****'
```

#### Request Body Parameter Description[​](#request-body-parameter-description "Direct link to Request Body Parameter Description")

| Parameter | Type | Required | Example | Description |
| --- | --- | --- | --- | --- |
| enable\_formula | bool | No | true | Whether to enable formula recognition. Default is `true`. |
| enable\_table | bool | No | true | Whether to enable table recognition. Default is `true`. |
| language | string | No | ch | Specify the document language, default is ​ch (Chinese). For other optional values, refer to the list of supported languages: <https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html#4-supported-languages-and-abbreviations> |
| file.name | string | Yes | demo.pdf | File name,support:.pdf, .doc, .docx, .ppt, .pptx, .png, .jpg, .jpeg |
| file.is\_ocr | bool | No | true | Whether to enable OCR functionality. Default is `false`. |
| file.data\_id | string | No | abc\*\* | The data ID corresponding to the parsing object. It consists of uppercase and lowercase English letters, numbers, underscores (`_`), hyphens (`-`), and periods (`.`), and does not exceed 128 characters. It can be used to uniquely identify your business data. |
| file.page\_ranges | string | No | 1-600 | Specifies a page range as a comma-separated string. Examples include 2,4-6 which selects pages [2,4,5,6] and 2 - -2 which selects all pages starting with the second page and ending with the next-to-last page (specified by -2) |
| callback | string | No | <http://127.0.0.1/callback> | The URL to receive callback notifications for parsing results. Supports HTTP and HTTPS protocols. If this field is empty, you must poll for parsing results periodically. The callback interface must support the POST method, UTF-8 encoding, `Content-Type: application/json` for data transmission, and include the parameters `checksum` and `content`. The parsing interface sets `checksum` and `content` according to the following rules and formats, and calls your callback interface to return the detection results. **checksum**: A string generated by concatenating the user `uid`, `seed`, and `content`, then applying the SHA256 algorithm. The user UID can be found in the personal center. To prevent tampering, when receiving the push result, you can generate the string using the above algorithm and verify it against the `checksum`. **content**: A JSON string. Please parse it back into a JSON object yourself. For examples of `content` results, refer to the task query result return examples, specifically the `data` section of the task query results. **Note**: When your server's callback interface receives a result pushed by the Mineru parsing service, an HTTP status code of `200` indicates successful reception. Any other HTTP status codes are considered reception failures. On failure, Mineru will retry pushing the detection results up to 5 times until successful. If reception still fails after 5 retries, no further pushes will be made. It is recommended to check the status of your callback interface. |
| seed | string | No | abc\*\* | A random string used for signing callback notification requests. It consists of English letters, numbers, and underscores (`_`), and does not exceed 64 characters. It is user-defined and used to verify that the callback notification request was initiated by the Mineru parsing service when receiving content security callback notifications. **Note**: When using `callback`, this field must be provided. |
| extra\_formats | [string] | No | ["docx","html"] | markdown and json are default export formats (do not need to be set), this parameter only supports one or multiple formats from: docx, html, latex |
| model\_version | string | No | vlm | mineru model version; options: pipeline or vlm, default is pipeline. |

#### Request Body Example[​](#request-body-example-1 "Direct link to Request Body Example")

```
{  
    "enable_formula": true,  
    "language": "en",  
    "enable_table": true,  
    "files": [  
        {"name": "demo.pdf", "is_ocr": true, "data_id": "abcd"}  
    ]  
}
```

#### Response Parameters[​](#response-parameters-2 "Direct link to Response Parameters")

| Parameter | Type | Example | Description |
| --- | --- | --- | --- |
| code | int | `0` | API status code. Success: `0`. |
| msg | string | `ok` | API processing message. Success: `"ok"`. |
| trace\_id | string | `c876cd60b202f2396de1f9e39a1b0172` | Request ID. |
| data.batch\_id | string | `2bb2f0ec-a336-4a0a-b61a-****` | Batch extraction task ID, can be used for batch result queries. |
| data.files | [string] | `["https://mineru.oss-cn-shanghai.aliyuncs.com/api-upload/***"]` | File upload links. |

#### Response Example[​](#response-example-2 "Direct link to Response Example")

```
{  
  "code": 0,  
  "data": {  
    "batch_id": "2bb2f0ec-a336-4a0a-b61a-241afaf9cc87",  
    "file_urls": [  
        "https://***"  
    ]  
  }  
  "msg": "ok",  
  "trace_id": "c876cd60b202f2396de1f9e39a1b0172"  
}
```

### Batch URL Upload and Parsing[​](#batch-url-upload-and-parsing "Direct link to Batch URL Upload and Parsing")

#### Interface Description[​](#interface-description-3 "Direct link to Interface Description")

Applicable to scenarios where extraction tasks are created in bulk via an API.

**Note:**

* You cannot request more than 200 links at once.
* The size of each file cannot exceed 200MB, and the number of pages must not exceed 600.
* Due to network restrictions, URLs hosted on GitHub, AWS, etc., may time out when requested.

#### Python Request Example[​](#python-request-example-3 "Direct link to Python Request Example")

```
import requests  
  
token = "***"  
url = "https://mineru.net/api/v4/extract/task/batch"  
header = {  
    "Content-Type": "application/json",  
    "Authorization": f"Bearer {token}"  
}  
data = {  
    "enable_formula": True,  
    "language": "ch",  
    "enable_table": True,  
    "files": [  
        {"url":"https://cdn-mineru.openxlab.org.cn/demo/example.pdf", "is_ocr": True, "data_id": "abcd"}  
    ]  
}  
try:  
    response = requests.post(url,headers=header,json=data)  
    if response.status_code == 200:  
        result = response.json()  
        print('response success. result:{}'.format(result))  
        if result["code"] == 0:  
            batch_id = result["data"]["batch_id"]  
            print('batch_id:{}'.format(batch_id))  
        else:  
            print('submit task failed,reason:{}'.format(result.msg))  
    else:  
        print('response not success. status:{} ,result:{}'.format(response.status_code, response))  
except Exception as err:  
    print(err)
```

#### CURL Response Example[​](#curl-response-example-2 "Direct link to CURL Response Example")

```
curl --location --request POST 'https://mineru.net/api/v4/extract/task/batch' \  
--header 'Authorization: Bearer ***' \  
--header 'Content-Type: application/json' \  
--header 'Accept: */*' \  
--data-raw '{  
    "enable_formula": true,  
    "language": "ch",  
    "enable_table": true,  
    "files": [  
        {"url":"https://cdn-mineru.openxlab.org.cn/demo/example.pdf", "is_ocr": true, "data_id": "abcd"}  
    ]  
}'
```

#### Request Body Parameters[​](#request-body-parameters-1 "Direct link to Request Body Parameters")

| Parameter | Type | Required | Example | Description |
| --- | --- | --- | --- | --- |
| enable\_formula | bool | No | `true` | Whether to enable formula recognition. Default is `true`. |
| enable\_table | bool | No | `true` | Whether to enable table recognition. Default is `true`. |
| language | string | No | `ch` | Specify the document language, default is ​ch (Chinese). For other optional values, refer to the list of supported languages: [PaddleOCR Multi Languages](https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html#4-supported-languages-and-abbreviations). |
| file.url | string | Yes | [`demo.pdf`](https://cdn-mineru.openxlab.org.cn/demo/example.pdf) | File link,support:.pdf, .doc, .docx, .ppt, .pptx, .png, .jpg, .jpeg |
| file.is\_ocr | bool | No | `true` | Whether to enable OCR functionality. Default is `false`. |
| file.data\_id | string | No | `abc**` | The data ID corresponding to the parsing object. It consists of uppercase and lowercase English letters, digits, underscores (`_`), hyphens (`-`), and periods (`.`), and does not exceed 128 characters. It can be used to uniquely identify your business data. |
| file.page\_ranges | string | No | 1-600 | Specifies a page range as a comma-separated string. Examples include 2,4-6 which selects pages [2,4,5,6] and 2 - -2 which selects all pages starting with the second page and ending with the next-to-last page (specified by -2) |
| callback | string | No | `http://127.0.0.1/callback` | The URL for callback notifications of the parsing result, supporting HTTP and HTTPS protocols. If this field is empty, you must regularly poll for the parsing result. The callback interface must support the POST method, UTF-8 encoding, and `Content-Type: application/json` for data transmission, as well as the parameters `checksum` and `content`. The parsing interface sets `checksum` and `content` according to the following rules and formats, then calls your callback interface to return the detection results. **checksum**: A string formatted as the user’s `uid` + `seed` + `content` concatenated, generated via the SHA256 algorithm. You can find your user `UID` in the user center. To prevent tampering, you can generate this string upon receiving the pushed result and compare it with `checksum` for verification. **content**: A JSON string; please parse and convert it back into a JSON object yourself. For an example of the `content` result, see the return example of the task query result, corresponding to the `data` part of the task query result. **Note**: When your server’s callback interface receives the results pushed by the Mineru parsing service, if the HTTP status code returned is `200`, it indicates successful reception; any other HTTP status code is regarded as a reception failure. In case of failure, the Mineru service will attempt to push the results up to `5` times until successfully received. If still not successful after `5` attempts, it will stop pushing. We suggest you check the status of your callback interface. |
| seed | string | No | `abc**` | A random string used for the signature in the callback notification. It consists of English letters, digits, and underscores (`_`), and does not exceed 64 characters. Defined by you, it is used to verify that the request was initiated by the Mineru parsing service when receiving the content security callback notification. **Note**: This field must be provided when using callback. |
| extra\_formats | [string] | No | ["docx","html"] | markdown and json are default export formats (do not need to be set), this parameter only supports one or multiple formats from: docx, html, latex |
| model\_version | string | No | vlm | mineru model version; options: pipeline or vlm, default is pipeline. |

#### Request Body Example[​](#request-body-example-2 "Direct link to Request Body Example")

```
{  
    "enable_formula": true,  
    "language": "en",  
    "enable_table": true,  
    "files": [  
        {"url":"https://cdn-mineru.openxlab.org.cn/demo/example.pdf", "is_ocr": true, "data_id": "abcd"}  
    ]  
}
```

#### Response Parameters[​](#response-parameters-3 "Direct link to Response Parameters")

| Parameter | Type | Required | Example | Description |
| --- | --- | --- | --- | --- |
| code | int | Yes | `0` | API status code. Success: `0`. |
| msg | string | Yes | `ok` | API processing message. Success: `"ok"`. |
| trace\_id | string | Yes | `c876cd60b202f2396de1f9e39a1b0172` | Request ID. |
| data.batch\_id | string | Yes | `2bb2f0ec-a336-4a0a-b61a-****` | Batch extraction task ID, can be used for batch result queries. |

#### Response Example[​](#response-example-3 "Direct link to Response Example")

```
{  
  "code": 0,  
  "data": {  
    "batch_id": "2bb2f0ec-a336-4a0a-b61a-241afaf9cc87"  
  },  
  "msg": "ok",  
  "trace_id": "c876cd60b202f2396de1f9e39a1b0172"  
}
```

### Batch Retrieve Task Results[​](#batch-retrieve-task-results "Direct link to Batch Retrieve Task Results")

#### Interface Description[​](#interface-description-4 "Direct link to Interface Description")

Use `batch_id` to batch query the progress of extraction tasks.

#### Python Request Example[​](#python-request-example-4 "Direct link to Python Request Example")

```
import requests  
  
token = "***"  
url = f"https://mineru.net/api/v4/extract-results/batch/{batch_id}"  
header = {  
    "Content-Type": "application/json",  
    "Authorization": f"Bearer {token}"  
}  
  
res = requests.get(url, headers=header)  
print(res.status_code)  
print(res.json())  
print(res.json()["data"])
```

#### CURL Response Example[​](#curl-response-example-3 "Direct link to CURL Response Example")

```
curl --location --request GET 'https://mineru.net/api/v4/extract-results/batch/{batch_id}' \  
--header 'Authorization: Bearer *****' \  
--header 'Accept: */*'
```

#### Response Parameters[​](#response-parameters-4 "Direct link to Response Parameters")

| Parameter | Type | Example | Description |
| --- | --- | --- | --- |
| code | int | `0` | API status code. Success: `0`. |
| msg | string | `ok` | API processing message. Success: `"ok"`. |
| trace\_id | string | `c876cd60b202f2396de1f9e39a1b0172` | Request ID. |
| data.batch\_id | string | `2bb2f0ec-a336-4a0a-b61a-241afaf9cc87` | `batch_id`. |
| data.extract\_result.file\_name | string | `demo.pdf` | File name. |
| data.extract\_result.state | string | `done` | Task processing status: `waiting-file`(waiting for file to be queued for parsing tasks.),`done` (completed), `pending` (in queue), `running` (being parsed), `failed` (parsing failed),`converting`(format converting). |
| data.extract\_result.full\_zip\_url | string | `https://cdn-mineru.openxlab.org.cn/pdf/018e53ad-d4f1-475d-b380-36bf24db9914.zip` | The compressed package of the file parsing result. |
| data.extract\_result.err\_msg | string | `The file format is not supported. Please upload a file of the required type.` | Reason for parsing failure; valid when `state=failed`. |
| data.extract\_result.data\_id | string | `abc**` | The data ID corresponding to the parsing object. **Note**: If `data_id` was passed in the parsing request parameters, it will return the corresponding `data_id` here. |
| data.extract\_result.extract\_progress.extracted\_pages | int | 1 | Number of pages parsed, valid when state=running |
| data.extract\_result.extract\_progress.start\_time | string | 2025-01-20 11:43:20 | Document parsing start time, valid when state=running |
| data.extract\_result.extract\_progress.total\_pages | int | 2 | Total number of pages in document, valid when state=running |

#### Response Example[​](#response-example-4 "Direct link to Response Example")

```
{  
  "code": 0,  
  "data": {  
    "batch_id": "2bb2f0ec-a336-4a0a-b61a-241afaf9cc87",  
    "extract_result": [  
      {  
        "file_name": "example.pdf",  
        "state": "done",  
        "err_msg": "",  
        "full_zip_url": "https://cdn-mineru.openxlab.org.cn/pdf/018e53ad-d4f1-475d-b380-36bf24db9914.zip"  
      },  
      {  
        "file_name":"demo.pdf",  
        "state": "running",  
        "err_msg": "",  
        "extract_progress": {  
          "extracted_pages": 1,  
          "total_pages": 2,  
          "start_time": "2025-01-20 11:43:20"  
        }  
      }  
    ]  
  },  
  "msg": "ok",  
  "trace_id": "c876cd60b202f2396de1f9e39a1b0172"  
}
```

### Common Error Codes[​](#common-error-codes "Direct link to Common Error Codes")

| Error Code | Description | Suggested Solution |
| --- | --- | --- |
| A0202 | Token Error | Check whether the Token is correct, or replace it with a new Token |
| A0211 | Token Expired | Replace with a new Token |
| -500 | Param invalid | Please check param and Content-Type |
| -10001 | Service Exception | Please try again later |
| -10002 | Request Parameter Error | Check the request parameter format |
| -60001 | Failed to generate upload URL, please try again | Please try again later |
| -60002 | Failed to get matching file format | Failed to detect the file type. Ensure that the requested file name and link have the correct extension, and the file is one of `pdf`, `doc`, `docx`, `ppt`, `pptx`, `png`,`jp(e)g`. |
| -60003 | File Reading Failed | Please check if the file is corrupted and re-upload |
| -60004 | Empty File | Please upload a valid file |
| -60005 | File Size Exceeds Limit | Check the file size; the maximum supported size is 200MB |
| -60006 | File Page Count Exceeds Limit | Please split the file and try again |
| -60007 | Model Service Temporarily Unavailable | Please try again later or contact technical support |
| -60008 | File Read Timeout | Check if the URL is accessible |
| -60009 | Task Submission Queue is Full | Please try again later |
| -60010 | Parsing Failed | Please try again later |
| -60011 | Failed to get a valid file | Ensure the file has been uploaded |
| -60012 | Task not found | Please ensure the task\_id is valid and not deleted |
| -60013 | No permission to access the task | Only tasks submitted by yourself can be accessed |
| -60014 | Delete running task | Running tasks do not support deletion |
| -60015 | File conversion failed | You can manually convert the file to PDF and re-upload |
| -60016 | File conversion failed | Failed to convert file to specified format, please try exporting in other formats or try again later |

* [Single File Parsing](#single-file-parsing)
  + [Creating a Parsing Task](#creating-a-parsing-task)
    - [Interface Description](#interface-description)
    - [Python Request Example](#python-request-example)
    - [CURL Request Example](#curl-request-example)
    - [Request Body Parameters](#request-body-parameters)
    - [Request Body Example](#request-body-example)
    - [Response Parameters](#response-parameters)
    - [Response Example](#response-example)
  + [Retrieve Task Results](#retrieve-task-results)
    - [Interface Description](#interface-description-1)
    - [Python Request Example](#python-request-example-1)
    - [CURL Response Example](#curl-response-example)
    - [Response Parameters](#response-parameters-1)
    - [Response Example](#response-example-1)
* [Batch File Parsing](#batch-file-parsing)
  + [Batch File Upload and Parsing](#batch-file-upload-and-parsing)
    - [Interface Description](#interface-description-2)
    - [Python Request Example](#python-request-example-2)
    - [CURL Response Example](#curl-response-example-1)
    - [CURL File Uploading Example](#curl-file-uploading-example)
    - [Request Body Parameter Description](#request-body-parameter-description)
    - [Request Body Example](#request-body-example-1)
    - [Response Parameters](#response-parameters-2)
    - [Response Example](#response-example-2)
  + [Batch URL Upload and Parsing](#batch-url-upload-and-parsing)
    - [Interface Description](#interface-description-3)
    - [Python Request Example](#python-request-example-3)
    - [CURL Response Example](#curl-response-example-2)
    - [Request Body Parameters](#request-body-parameters-1)
    - [Request Body Example](#request-body-example-2)
    - [Response Parameters](#response-parameters-3)
    - [Response Example](#response-example-3)
  + [Batch Retrieve Task Results](#batch-retrieve-task-results)
    - [Interface Description](#interface-description-4)
    - [Python Request Example](#python-request-example-4)
    - [CURL Response Example](#curl-response-example-3)
    - [Response Parameters](#response-parameters-4)
    - [Response Example](#response-example-4)
  + [Common Error Codes](#common-error-codes)