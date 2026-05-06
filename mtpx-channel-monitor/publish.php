<?php
// Publica 1 mensagem JetStream em legado.default via protocolo NATS cru.
// Uso: php publish.php '{"orderId":"abc"}'

$payload = $argv[1] ?? '{"orderId":"php-test","ts":' . time() . '}';
$subject = getenv('SUBJECT') ?: 'legado.default';
$host    = getenv('NATS_HOST') ?: 'localhost';
$port    = (int)(getenv('NATS_PORT') ?: 4222);

$sock = stream_socket_client("tcp://$host:$port", $err, $msg, 5)
    or exit("connect: $msg\n");

fgets($sock); // INFO
fwrite($sock, "CONNECT {\"verbose\":false,\"pedantic\":false}\r\n");

// PUB com reply-to para receber ACK do JetStream
$reply = '_INBOX.' . bin2hex(random_bytes(8));
fwrite($sock, "SUB $reply 1\r\n");
fwrite($sock, "PUB $subject $reply " . strlen($payload) . "\r\n$payload\r\n");

stream_set_timeout($sock, 2);
while (!feof($sock)) {
    $line = fgets($sock);
    if (str_starts_with($line, 'MSG ')) {
        $ack = fgets($sock);
        echo "✔ $subject ← $payload\n  ack: " . trim($ack) . "\n";
        break;
    }
}
fclose($sock);
